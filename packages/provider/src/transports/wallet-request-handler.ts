import { EventEmitter2 as EventEmitter } from 'eventemitter2';

import {
  ProviderMessageRequest,
  ProviderMessageResponse,
  ProviderMessageRequestHandler,
  MessageToSign,
  ProviderRpcError,
  ConnectOptions,
  ConnectDetails,
  PromptConnectDetails,
  WalletSession,
  OpenWalletIntent,
  ErrSignedInRequired,
  ProviderEventTypes,
  TypedEventEmitter
} from '../types';
import { UserTokenInfo, getUserERC20Tokens, getTokenMetadataByAddress, getHistories, getTokenAllowances } from '@0xsodium/graphquery';
import { ethers, utils } from 'ethers';
import { ExternalProvider } from '@ethersproject/providers';
import { NetworkConfig, JsonRpcHandler, JsonRpcRequest, JsonRpcResponseCallback, JsonRpcResponse } from '@0xsodium/network';
import { Signer } from '@0xsodium/wallet';
import { Transactionish, flattenAuxTransactions } from '@0xsodium/transactions';
import { signAuthorization, AuthorizationOptions } from '@0xsodium/auth';
import { logger, TypedData, AddressZero, ERC20OrNativeTokenMetadata } from '@0xsodium/utils';
import { prefixEIP191Message, isWalletUpToDate } from '../utils';
import moize from 'moize';

const getTokenPrices = async (chain: string, tokenAddressList: string[]): Promise<{ [tokenAddress: string]: { usd: number } }> => {
  const query = `vs_currencies=usd&contract_addresses=${tokenAddressList.join(",")}`
  const requestURL = `https://api.coingecko.com/api/v3/simple/token_price/${chain}?${query}`
  const coingeckoRes = await fetch(requestURL)
  const prices = await coingeckoRes.json()
  return prices;
}

const getTokenPricesWithCache = moize(getTokenPrices, {
  isDeepEqual: true,
  isPromise: true,
  // 30 seconds
  maxAge: 50 * 1000,
});

const SIGNER_READY_TIMEOUT = 10000

export interface WalletSignInOptions {
  connect?: boolean
  mainnetNetworks?: NetworkConfig[]
  testnetNetworks?: NetworkConfig[]
  defaultNetworkId?: string | number
}

export class WalletRequestHandler implements ExternalProvider, JsonRpcHandler, ProviderMessageRequestHandler {
  // signer interface of the wallet. A null value means there is no signer (ie. user not signed in). An undefined
  // value means the signer state is unknown, usually meaning the wallet app is booting up and initializing. Of course
  // a Signer value is the actually interface to a signed-in account
  private signer: Signer | null | undefined
  private signerReadyCallbacks: Array<() => void> = []

  private prompter: WalletUserPrompter | null
  private mainnetNetworks: NetworkConfig[]
  private testnetNetworks: NetworkConfig[]

  private _openIntent?: OpenWalletIntent
  private _connectOptions?: ConnectOptions
  private _defaultNetworkId?: string | number
  private _chainId?: number

  private events: TypedEventEmitter<ProviderEventTypes> = new EventEmitter() as TypedEventEmitter<ProviderEventTypes>

  constructor(
    signer: Signer | null | undefined,
    prompter: WalletUserPrompter | null,
    mainnetNetworks: NetworkConfig[],
    testnetNetworks: NetworkConfig[] = []
  ) {
    this.signer = signer
    this.prompter = prompter
    this.mainnetNetworks = mainnetNetworks
    this.testnetNetworks = testnetNetworks
  }

  async signIn(signer: Signer | null, options: WalletSignInOptions = {}) {
    this.setSigner(signer)

    const { connect, mainnetNetworks, testnetNetworks, defaultNetworkId } = options

    if (mainnetNetworks && mainnetNetworks.length > 0) {
      this.mainnetNetworks = mainnetNetworks
    }
    if (testnetNetworks && testnetNetworks.length > 0) {
      this.testnetNetworks = testnetNetworks
    }
    if (
      (!this.mainnetNetworks || this.mainnetNetworks.length === 0) &&
      (!this.testnetNetworks || this.testnetNetworks.length === 0)
    ) {
      throw new Error('signIn failed as network configuration is empty')
    }

    const networkId = defaultNetworkId || this._defaultNetworkId
    if (networkId) {
      if (!(await this.setDefaultNetwork(networkId, false))) {
        throw new Error(`WalletRequestHandler setup unable to set defaultNetworkId ${networkId}`)
      }
    }

    // Optionally, connect the dapp and wallet. In case connectOptions are provided, we will perform
    // necessary auth request, and then notify the dapp of the 'connect' details.
    //
    // NOTE: if a user is signing into a dapp from a fresh state, and and auth request is made
    // we don't trigger the promptConnect flow, as we consider the user just authenticated
    // for this dapp, so its safe to authorize in the connect() method without the prompt.
    //
    // NOTE: signIn can optionally connect and notify dapp at this time for new signIn flows
    if (connect) {
      const connectOptions = this._connectOptions
      const connectDetails = await this.connect(connectOptions)
      this.notifyConnect(connectDetails)
      if (!connectOptions || connectOptions.keepWalletOpened !== true) {
        this.notifyClose()
      }
    }
  }

  signOut() {
    // signed out state
    this.setSigner(null)
  }

  signerReset() {
    // resetting signer puts the wallet in an uninitialized state, which requires the app to
    // re-initiatize and set the signer either as "null" (ie. no signer) or "Signer" (ie. signed in).
    this.signer = undefined
  }

  signerReady(timeout: number = SIGNER_READY_TIMEOUT): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.signer !== undefined) {
        resolve()
      } else {
        setTimeout(() => {
          if (this.signer === undefined) {
            this.signerReadyCallbacks = []
            reject(`signerReady timed out`)
          }
        }, timeout)
        this.signerReadyCallbacks.push(resolve)
      }
    })
  }

  async connect(options?: ConnectOptions): Promise<ConnectDetails> {
    if (!this.signer) {
      return {
        connected: false,
        chainId: '0x0',
        error: 'unable to connect without signed in account'
      }
    }

    const connectDetails: ConnectDetails = {
      connected: true,
      chainId: ethers.utils.hexlify(await this.getChainId())
    }

    if (options && options.authorize) {
      // Perform ethauth eip712 request and construct the ConnectDetails response
      // including the auth proof
      const authOptions: AuthorizationOptions = {
        app: options.app,
        origin: options.origin,
        expiry: options.expiry
      }
      // if (typeof(options.authorize) === 'object') {
      //   authOptions = { ...authOptions, ...options.authorize }
      // }
      try {
        connectDetails.proof = await signAuthorization(this.signer, authOptions)
      } catch (err) {
        logger.warn(`connect, signAuthorization failed for options: ${JSON.stringify(options)}, due to: ${err.message}`)
        return {
          connected: false,
          chainId: '0x0',
          error: `signAuthorization failed: ${err.message}`
        }
      }
    }
    // Build session response for connect details
    connectDetails.session = await this.walletSession()
    return connectDetails
  }

  promptConnect = async (options?: ConnectOptions): Promise<ConnectDetails> => {
    if (!options && !this._connectOptions) {
      // this is an unexpected state and should not happen
      throw new Error('prompter connect options are empty')
    }
    if (!this.prompter) {
      // if prompter is null, we'll auto connect
      return this.connect(options)
    }
    const promptConnectDetails = await this.prompter.promptConnect(options || this._connectOptions).catch(error => {
      return { connected: false, error: error.message } as ConnectDetails
    })
    const connectDetails: ConnectDetails = promptConnectDetails
    if (connectDetails.connected && !connectDetails.session) {
      connectDetails.session = await this.walletSession()
    }
    return promptConnectDetails
  }

  // sendMessageRequest will unwrap the ProviderMessageRequest and send it to the JsonRpcHandler
  // (aka, the signer in this instance) and then responds with a wrapped response of
  // ProviderMessageResponse to be sent over the transport
  sendMessageRequest(message: ProviderMessageRequest): Promise<ProviderMessageResponse> {
    return new Promise(resolve => {
      this.sendAsync(
        message.data,
        (error: any, response?: JsonRpcResponse) => {
          // TODO: if response includes data.error, why do we need a separate error argument here?

          const responseMessage: ProviderMessageResponse = {
            ...message,
            data: response!
          }

          // NOTE: we always resolve here, are the sendAsync call will wrap any exceptions
          // in the error field of the response to ensure we send back to the user
          resolve(responseMessage)
        },
        message.chainId
      )
    })
  }

  // sendAsync implements the JsonRpcHandler interface for sending JsonRpcRequests to the wallet
  sendAsync = async (request: JsonRpcRequest, callback: JsonRpcResponseCallback, chainId?: number) => {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: request.id!,
      result: null
    }

    await this.getSigner();

    try {
      // only allow public json rpc method to the provider when user is not logged in, aka signer is not set
      if ((!this.signer || this.signer === null) && !permittedJsonRpcMethods.includes(request.method)) {
        throw ErrSignedInRequired
      }

      // wallet signer
      const signer = this.signer
      if (!signer) throw new Error('WalletRequestHandler: wallet signer is not configured')

      // fetch the provider for the specific chain, or undefined will select defaultChain
      const provider = await signer.getProvider(chainId)
      if (!provider) throw new Error(`WalletRequestHandler: wallet provider is not configured for chainId ${chainId}`)

      if (!chainId) {
        const network = await provider.getNetwork();
        chainId = network.chainId;
      }

      switch (request.method) {
        case 'net_version': {
          const result = await provider.send('net_version', [])
          response.result = result
          break
        }

        case 'eth_chainId': {
          const chainId = await this.getChainId();
          response.result = utils.hexlify(chainId);
          break
        }

        case 'eth_accounts': {
          const walletAddress = await signer.getAddress()
          response.result = [walletAddress]
          break
        }

        case 'eth_getBalance': {
          const [accountAddress, blockTag] = request.params!
          const walletAddress = await this.getAddress();
          if (accountAddress == walletAddress) {
            const walletBalance = await signer.getBalance(chainId, blockTag)
            response.result = walletBalance.toHexString()
            break
          }
          const walletBalance = await provider.getBalance(accountAddress, blockTag)
          response.result = walletBalance.toHexString()
          break
        }

        case 'personal_sign':
        case 'eth_sign': {
          // note: message from json-rpc input is in hex format
          let message: any

          // there is a difference in the order of the params:
          // personal_sign: [data, address]
          // eth_sign: [address, data]
          if (request.method === 'personal_sign') {
            const [data, address] = request.params!
            message = data
          } else {
            const [address, data] = request.params!
            message = data
          }

          let sig = ''

          // Message must be prefixed with "\x19Ethereum Signed Message:\n"
          // as defined by EIP-191
          const prefixedMessage = prefixEIP191Message(message)

          // TODO:
          // if (process.env.TEST_MODE === 'true' && this.prompter === null) {
          if (this.prompter === null) {
            // prompter is null, so we'll sign from here
            sig = await signer.signMessage(prefixedMessage, chainId)
          } else {
            const promptResultForDeployment = await this.handleConfirmWalletDeployPrompt(this.prompter, signer, chainId)
            if (promptResultForDeployment) {
              sig = await this.prompter.promptSignMessage({ chainId: chainId, message: prefixedMessage }, this.connectOptions)
            }
          }

          if (sig && sig.length > 0) {
            response.result = sig
          } else {
            // The user has declined the request when value is null
            throw new Error('declined by user')
          }
          break
        }

        case 'eth_signTypedData':
        case 'eth_signTypedData_v4': {
          // note: signingAddress from json-rpc input is in hex format, and typedDataObject
          // should be an object, but in some instances may be double string encoded
          const [signingAddress, typedDataObject] = request.params!

          let typedData: TypedData | undefined = undefined
          if (typeof typedDataObject === 'string') {
            try {
              typedData = JSON.parse(typedDataObject)
            } catch (e) { }
          } else {
            typedData = typedDataObject
          }

          if (!typedData || !typedData.domain || !typedData.types || !typedData.message) {
            throw new Error('invalid typedData object')
          }

          let sig = ''

          if (this.prompter === null) {
            // prompter is null, so we'll sign from here
            sig = await signer.signTypedData(typedData.domain, typedData.types, typedData.message, chainId)
          } else {
            const promptResultForDeployment = await this.handleConfirmWalletDeployPrompt(this.prompter, signer, chainId)
            if (promptResultForDeployment) {
              sig = await this.prompter.promptSignMessage({ chainId: chainId, typedData: typedData }, this.connectOptions)
            }
          }

          if (sig && sig.length > 0) {
            response.result = sig
          } else {
            // The user has declined the request when value is null
            throw new Error('declined by user')
          }
          break
        }

        case 'eth_sendTransaction': {
          // https://eth.wiki/json-rpc/API#eth_sendtransaction
          const [transactionParams] = request.params!

          // eth_sendTransaction uses 'gas'
          // ethers and sodium use 'gasLimit'
          if ('gas' in transactionParams && transactionParams.gasLimit === undefined) {
            transactionParams.gasLimit = transactionParams.gas
            delete transactionParams.gas
          }

          let transactions = flattenAuxTransactions(transactionParams);

          if (!isWalletUpToDate(signer, chainId)) {
            const walletUpgradeTransactions = await signer.getWalletUpgradeTransactions(chainId);
            transactions = [...walletUpgradeTransactions, ...transactions];
          }

          let txnHash = ''
          if (this.prompter === null) {
            // prompter is null, so we'll send from here
            // TODO: 开发者模式下，不需要用户确认
            // 只支持API session调用.
            const txnResponse = await signer.sendTransaction(transactions, chainId)
            txnHash = txnResponse.hash
          } else {
            // prompt user to provide the response
            txnHash = await this.prompter.promptSendTransaction(
              transactions,
              chainId,
              this.connectOptions
            );
          }

          if (txnHash) {
            response.result = txnHash
          } else {
            // The user has declined the request when value is null
            throw new Error('declined by user')
          }
          break
        }

        case 'eth_signTransaction': {
          // https://eth.wiki/json-rpc/API#eth_signTransaction
          const [transaction] = request.params!
          const sender = ethers.utils.getAddress(transaction.from)

          if (sender !== (await signer.getAddress())) {
            throw new Error('sender address does not match wallet')
          }

          throw new Error('eth_signTransaction is not supported')
          // if (this.prompter === null) {
          //   // The eth_signTransaction method expects a `string` return value we instead return a `SignedTransactions` object,
          //   // this can only be broadcasted using an RPC provider with support for signed Sequence transactions, like this one.
          //   //
          //   // TODO: verify serializing / transporting the SignedTransaction object works as expected, most likely however
          //   // we will want to resolveProperties the bignumber values to hex strings
          //   response.result = await signer.signTransactions(transaction, chainId)
          // } else {
          //   response.result = await this.prompter.promptSignTransaction(transaction, chainId, this.connectOptions)
          // }
        }

        case 'eth_sendRawTransaction': {
          throw new Error('eth_sendRawTransaction is not supported');
        }

        case 'eth_getTransactionCount': {
          const address = ethers.utils.getAddress(request.params![0] as string)
          const tag = request.params![1]

          const walletAddress = ethers.utils.getAddress(await signer.getAddress())

          if (address === walletAddress) {
            const count = await signer.getTransactionCount(tag)
            response.result = ethers.BigNumber.from(count).toHexString()
          } else {
            const count = await provider.getTransactionCount(address, tag)
            response.result = ethers.BigNumber.from(count).toHexString()
          }
          break
        }

        case 'eth_blockNumber': {
          response.result = await provider.getBlockNumber()
          break
        }

        case 'eth_getBlockByNumber': {
          response.result = await provider.getBlock(request.params![0] /* , jsonRpcRequest.params[1] */)
          break
        }

        case 'eth_getBlockByHash': {
          response.result = await provider.getBlock(request.params![0] /* , jsonRpcRequest.params[1] */)
          break
        }

        case 'eth_getTransactionByHash': {
          response.result = await provider.getTransaction(request.params![0])
          break
        }

        case 'eth_coinbase': {
          const walletAddress = ethers.utils.getAddress(await signer.getAddress())
          response.result = walletAddress;
          break
        }

        case 'eth_call': {
          const [transactionObject, blockTag] = request.params!
          response.result = await provider.call(transactionObject, blockTag)
          break
        }

        case 'eth_getCode': {
          const [contractAddress, blockTag] = request.params!
          response.result = await provider.getCode(contractAddress, blockTag)
          break
        }

        case 'eth_estimateGas': {
          const [transactionObject] = request.params!
          response.result = await provider.estimateGas(transactionObject)
          break
        }

        case 'eth_gasPrice': {
          const gasPrice = await provider.getGasPrice()
          response.result = gasPrice.toHexString()
          break
        }

        case 'wallet_switchEthereumChain': {
          const [switchParams] = request.params!
          if (!switchParams.chainId || switchParams.chainId.length === 0) {
            throw new Error('invalid chainId')
          }

          const chainId = ethers.BigNumber.from(switchParams.chainId)

          const ok = await this.setDefaultNetwork(chainId.toString(), true)
          if (!ok) {
            throw new Error(`unable to set chainId ${chainId}`)
          }

          response.result = null // success
          break
        }

        case 'sodium_getTokens': {
          let [walletAddress, chainId, first] = request.params!;
          const provider = await signer.getProvider(chainId)
          if (!provider) {
            throw new Error(`unable to find provider with chainId ${chainId}`);
          }
          if (!walletAddress) {
            walletAddress = await signer.getAddress();
          }

          if (!chainId) {
            chainId = await signer.getChainId();
          }

          if (!first) {
            first = 10;
          }

          const nativeTokenBalance = await signer.getBalance(chainId);
          const networks = await this.getNetworks();
          const network = networks.find((network) => network.chainId === chainId);
          if (!network) {
            throw new Error(`unable to find network with chainId ${chainId}`);
          }
          response.result = [
            {
              token: {
                address: AddressZero,
                chainId: chainId,
                isNativeToken: true,
                name: network.name,
                symbol: network.nativeTokenSymbol,
                decimals: 18,
                centerData: network.centerData,
              },
              balance: nativeTokenBalance,
            }
          ] as UserTokenInfo[];
          const addressOfWallet = await signer.getAddress();
          const erc20TokenInfos = await getUserERC20Tokens(
            network.subgraphHost ?? 'https://api.thegraph.com',
            addressOfWallet,
            chainId,
            first,
            provider,
          );
          erc20TokenInfos.forEach(v => {
            response.result.push(v);
          })
          break;
        }

        case 'sodium_getTransactionHistory': {
          // TODO tokenId coming soon when nft support
          const [skip, first, chainId, tokenAddress, tokenId] = request.params!

          const networks = await this.getNetworks();
          const network = networks.find((network) => network.chainId === chainId);
          if (!network) {
            throw new Error(`unable to find network with chainId ${chainId}`);
          }

          const address = await signer.getAddress();
          const result = await getHistories(
            network.subgraphHost ?? 'https://api.thegraph.com',
            address,
            chainId,
            first,
            skip,
            tokenAddress
          );
          response.result = result;
          break;
        }

        case 'sodium_getAccountAllowances': {
          // TODO tokenId coming soon when nft support
          const [skip, first, chainId] = request.params!
          const provider = await signer.getProvider(chainId)
          if (!provider) {
            throw new Error(`unable to find provider with chainId ${chainId}`);
          }
          const networks = await this.getNetworks();
          const network = networks.find((network) => network.chainId === chainId);
          if (!network) {
            throw new Error(`unable to find network with chainId ${chainId}`);
          }

          const address = await signer.getAddress();
          const result = await getTokenAllowances(
            network.subgraphHost ?? 'https://api.thegraph.com',
            address,
            chainId,
            first,
            skip,
            provider,
          );
          response.result = result;
          break;
        }

        case 'sodium_getTokenRates': {
          let [tokenAddressList, xchainId] = request.params!

          let chainId = parseInt(xchainId);

          const chainmap: {
            [keyof: number]: {
              id: string,
              wtoken: string,
            }
          } = {
            137: {
              id: "polygon-pos",
              wtoken: "0x0000000000000000000000000000000000001010",
            },
            56: {
              id: "binance-smart-chain",
              wtoken: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
            },
            1: {
              id: "ethereum",
              wtoken: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
            },
            // arbitrum-one
            42161: {
              id: "ethereum",
              wtoken: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
            },
            31337: {
              id: "ethereum",
              wtoken: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
            },
            // arbitrum-nova
            42170: {
              id: "ethereum",
              wtoken: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
            },
          };

          const x = chainmap[chainId];
          if (!x) {
            response.result = tokenAddressList.map((_: string) => {
              return 0
            });
            break;
          }

          tokenAddressList = tokenAddressList.map((tokenAddress: string) => {
            if (tokenAddress === AddressZero) {
              return chainmap[chainId].wtoken;
            }
            return tokenAddress;
          });

          let chain = x.id;
          const prices = await getTokenPricesWithCache(chain, tokenAddressList);
          response.result = tokenAddressList.map((tokenAddress: string) => {
            const price = prices[tokenAddress.toLowerCase()]
            return price ? price.usd : 0
          });
          break;
        }

        case 'sodium_getToken': {
          const [tokenAddress, chainId] = request.params!
          const provider = await signer.getProvider(chainId)
          if (!provider) {
            throw new Error(`unable to find provider with chainId ${chainId}`);
          }
          const tokenMetadata = await getTokenMetadataByAddress(tokenAddress, chainId, provider);
          const tokenInfo: ERC20OrNativeTokenMetadata = {
            address: tokenAddress,
            chainId: chainId,
            decimals: tokenMetadata.decimals,
            symbol: tokenMetadata.symbol,
            name: tokenMetadata.name,
            centerData: tokenMetadata.centerData,
          }
          response.result = tokenInfo;
          break;
        }

        // smart wallet method
        case 'sodium_getWalletContext': {
          response.result = await signer.getWalletContext()
          break
        }

        // smart wallet method
        case 'sodium_getWalletConfig': {
          const [chainId] = request.params!
          response.result = await signer.getWalletConfig(chainId)
          break
        }

        // smart wallet method
        case 'sodium_getWalletState': {
          const [chainId] = request.params!
          response.result = await signer.getWalletState(chainId)
          break
        }

        // smart wallet method
        case 'sodium_getNetworks': {
          // NOTE: must ensure that the response result below returns clean serialized data, which is to omit
          // the provider and relayer objects and only return the urls so can be reinstantiated on dapp side.
          // This is handled by this.getNetworks() but noted here for future readers.
          response.result = await this.getNetworks(true)
          break
        }

        // set default network of wallet
        case 'sodium_setDefaultNetwork': {
          const [defaultNetworkId] = request.params!

          if (!defaultNetworkId) {
            throw new Error('invalid request, method argument defaultNetworkId cannot be empty')
          }
          const ok = await this.setDefaultNetwork(defaultNetworkId)
          if (!ok) {
            throw new Error(`unable to set default network ${defaultNetworkId}`)
          }

          response.result = await this.getNetworks(true)
          break
        }

        case 'sodium_waitForUserOpHash': {
          const [
            userOpHash,
            confirmations,
            timeout,
          ] = request.params!
          const tr = await signer.waitForUserOpHash(userOpHash, confirmations, timeout, chainId);
          response.result = tr;
          break
        }

        default: {
          // NOTE: provider here will be chain-bound if chainId is provided
          const providerResponse = await provider.send(request.method, request.params!)
          response.result = providerResponse
        }
      }
    } catch (err: any) {
      logger.error(err)

      // See https://github.com/ethereum/EIPs/blob/master/EIPS/eip-1193.md#rpc-errors
      response.result = null

      if (typeof err == "string") {
        response.error = {
          name: "rpc-error",
          message: err,
          code: 4001
        }
      } else if (typeof err == "object") {
        response.error = {
          name: "rpc-error",
          message: err.toString(),
          code: 4001
        }

        if ("stack" in err) {
          response.error.stack = err.stack;
        }
      } else {
        response.error = {
          ...err,
          code: 4001
        }
      }
    }

    if (response.error
      && response.error.message === 'user cancel'
    ) {
      response.error.code = 4003;
    }

    callback(undefined, response)
  }

  on<K extends keyof ProviderEventTypes>(event: K, fn: ProviderEventTypes[K]) {
    this.events.on(event, fn as any)
  }

  once<K extends keyof ProviderEventTypes>(event: K, fn: ProviderEventTypes[K]) {
    this.events.once(event, fn as any)
  }

  async getAddress(): Promise<string> {
    if (!this.signer) {
      return ''
    } else {
      return this.signer.getAddress()
    }
  }

  async getChainId(): Promise<number> {
    if (!this.signer) {
      return 0
    } else {
      if (this._chainId) return this._chainId // memoized
      this._chainId = await this.signer.getChainId()
      return this._chainId
    }
  }

  get openIntent(): OpenWalletIntent | undefined {
    return this._openIntent
  }

  setOpenIntent(intent: OpenWalletIntent | undefined) {
    this._openIntent = intent
  }

  get connectOptions(): ConnectOptions | undefined {
    return this._connectOptions
  }

  setConnectOptions(options: ConnectOptions | undefined) {
    this._connectOptions = options
  }

  get defaultNetworkId(): string | number | undefined {
    return this._defaultNetworkId
  }

  async setDefaultNetwork(chainId: string | number, notifyNetworks: boolean = true): Promise<number | undefined> {
    if (!chainId) return undefined
    this._defaultNetworkId = chainId
    this._chainId = undefined
    if (this.signer && (<any>this.signer).setNetworks) {
      const defaultChainId: number = (<any>this.signer).setNetworks(this.mainnetNetworks, this.testnetNetworks, chainId)
      if (defaultChainId && notifyNetworks) {
        await this.notifyNetworks()
      }
      return defaultChainId
    } else {
      return undefined
    }
  }

  async getNetworks(jsonRpcResponse?: boolean): Promise<NetworkConfig[]> {
    if (!this.signer) {
      logger.warn('signer not set: getNetworks is returning an empty list')
      return []
    }

    const networks = await this.signer.getNetworks()

    if (jsonRpcResponse) {
      // omit provider and relayer objects as they are not serializable
      return networks.map(n => {
        const network: NetworkConfig = { ...n }
        network.provider = undefined
        return network
      })
    } else {
      return networks
    }
  }

  async walletSession(): Promise<WalletSession | undefined> {
    return !this.signer
      ? undefined
      : {
        walletContext: await this.signer.getWalletContext(),
        accountAddress: await this.signer.getAddress(),
        networks: await this.getNetworks(true)
      }
  }

  notifyConnect(connectDetails: ConnectDetails, origin?: string) {
    this.events.emit('connect', connectDetails)
    if (connectDetails.session?.accountAddress) {
      this.events.emit('accountsChanged', [connectDetails.session?.accountAddress], origin)
    }
  }

  notifyDisconnect(origin?: string) {
    this.events.emit('accountsChanged', [], origin)
    this.events.emit('disconnect')
  }

  async notifyNetworks(networks?: NetworkConfig[]) {
    const n = networks || (await this.getNetworks(true))
    this.events.emit('networks', n)
    if (n.length > 0) {
      const defaultNetwork = n.find(network => network.isDefaultChain)
      if (defaultNetwork) {
        this.events.emit('chainChanged', ethers.utils.hexlify(defaultNetwork.chainId))
      }
    } else {
      this.events.emit('chainChanged', '0x0')
    }
  }

  async notifyWalletContext() {
    if (!this.signer) {
      logger.warn('signer not set: skipping to notify wallet context')
      return
    }
    const walletContext = await this.signer.getWalletContext()
    this.events.emit('walletContext', walletContext)
  }

  notifyClose(error?: ProviderRpcError) {
    this.events.emit('close', error)
  }

  isSignedIn = async (): Promise<boolean> => {
    await this.signerReady()
    return !!this.signer
  }

  getSigner = async (): Promise<Signer | null> => {
    await this.signerReady()
    if (this.signer === undefined) {
      throw new Error('signerReady failed resolve')
    }
    return this.signer
  }

  setSigner(signer: Signer | null | undefined) {
    this.signer = signer

    if (signer !== undefined) {
      for (let i = 0; i < this.signerReadyCallbacks.length; i++) {
        this.signerReadyCallbacks[i]()
      }
      this.signerReadyCallbacks = []
    }
  }

  private async handleConfirmWalletDeployPrompt(
    prompter: WalletUserPrompter,
    signer: Signer,
    chainId: number
  ): Promise<boolean> {
    const isUpToDate = await isWalletUpToDate(signer, chainId)
    if (isUpToDate) {
      return true
    }
    const promptResult = await prompter.promptConfirmWalletDeploy(chainId!, this.connectOptions)
    // if client returned true, check again to make sure wallet is deployed and up to date
    if (promptResult) {
      const isPromptResultCorrect = await isWalletUpToDate(signer, chainId!)
      if (!isPromptResultCorrect) {
        logger.error('WalletRequestHandler: result for promptConfirmWalletDeploy is not correct')
        return false
      } else {
        return true
      }
    }
    return false
  }
}

export interface WalletUserPrompter {
  promptConnect(options?: ConnectOptions): Promise<PromptConnectDetails>
  promptSignMessage(message: MessageToSign, options?: ConnectOptions): Promise<string>
  promptSignTransaction(txn: Transactionish, chaindId?: number, options?: ConnectOptions): Promise<string>
  promptSendTransaction(txn: Transactionish, chaindId?: number, options?: ConnectOptions): Promise<string>

  // 合约部署或者更新session时调用.
  promptConfirmWalletDeploy(chainId: number, options?: ConnectOptions): Promise<boolean>
}

const permittedJsonRpcMethods = [
  'net_version',
  'eth_chainId',
  'eth_getBalance',
  'eth_getTransactionCount',
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionByHash',
  'eth_getCode',
  'eth_estimateGas',
  'eth_gasPrice',

  'sodium_getWalletContext',
  'sodium_getNetworks',
  'sodium_setDefaultNetwork'
]
