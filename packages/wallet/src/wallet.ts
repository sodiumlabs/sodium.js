import { Provider, BlockTag, JsonRpcProvider as EthJsonRpcProvider, TransactionResponse, TransactionReceipt } from '@ethersproject/providers'
import { BigNumber, ethers, Signer as AbstractSigner } from 'ethers';
import { TypedDataDomain, TypedDataField } from '@ethersproject/abstract-signer';
import { BytesLike } from '@ethersproject/bytes';
import { Deferrable } from '@ethersproject/properties';
import { ConnectionInfo } from '@ethersproject/web';
import {
  Transactionish,
  TransactionRequest,
  Transaction
} from '@0xsodium/transactions';

import {
  ChainIdLike,
  JsonRpcSender,
  NetworkConfig,
  JsonRpcProvider,
  SodiumContext,
  getChainId,
  createContext,
} from '@0xsodium/network';

import {
  WalletConfig,
  WalletState,
  sortConfig,
} from '@0xsodium/config';
import { encodeTypedDataDigest, subDigestOf } from '@0xsodium/utils';
import {
  resolveArrayProperties,
  SodiumNetworkAuthProof,
  DelegateProof,
  signType2,
  signType1,
  genDelegateProof,
  TypedDataSigner
} from './utils';
import { Signer } from './signer';
import {
  CompatibilityFallbackHandler__factory,
  EntryPoint__factory,
  Sodium__factory
} from '@0xsodium/wallet-contracts';
import { defaultAbiCoder } from '@ethersproject/abi';
import {
  SodiumUserOpBuilder,
  IClient,
  Client,
  AATransactionReceipt,
} from './userop';
import { IUserOperation } from 'userop';
// Wallet is a signer interface to a Smart Contract based Ethereum account.
//
// Wallet allows managing the account/wallet sub-keys, wallet address, signing
// messages, signing transactions and updating/deploying the wallet config on a specific chain.
//
// Wallet instances represent a wallet at a particular config-state, in someways, the Wallet
// instance is immutable, and if you update the config, then you'll need to call useConfig()
// to instantiate a new Wallet instance with the updated config.

export interface WalletOptions {
  // config is the wallet multi-sig configuration. Note: the first config of any wallet
  // before it is deployed is used to derive it's the account address of the wallet.
  config: WalletConfig

  // context is the WalletContext of deployed wallet-contract modules for the Smart Wallet
  context?: Partial<SodiumContext>

  // strict mode will ensure the WalletConfig is usable otherwise throw (on by default)
  strict?: boolean
}

export class Wallet extends Signer {
  readonly context: SodiumContext
  readonly config: WalletConfig

  private readonly _signer: TypedDataSigner

  // provider is an Ethereum Json RPC provider that is connected to a particular network (aka chain)
  // and access to the signer for signing transactions.
  provider: EthJsonRpcProvider

  bundlerURL: string

  // sender is a minimal Json RPC sender interface. It's here for convenience for other web3
  // interfaces to use.
  sender: JsonRpcSender

  network: NetworkConfig;

  // relayer dispatches transactions to an Ethereum node directly
  // or through a remote transaction Web Service.
  // relayer: Relayer

  // chainId is the node network id, used for memoization
  chainId?: number

  _isDeployed?: boolean

  private opBuilderPromise: Promise<SodiumUserOpBuilder>
  private opClientPromise: Promise<IClient>

  constructor(
    options: WalletOptions,
    signer: (BytesLike | TypedDataSigner),
    private sodiumNetworkAuthProof?: SodiumNetworkAuthProof,
    private delegateProof?: DelegateProof,
  ) {
    super()

    const { config, context } = options

    this.context = createContext(context)
    this.config = sortConfig(config)
    this._signer = TypedDataSigner.isTypedDataSigner(signer) ? signer : new ethers.Wallet(signer)
  }

  getUserOpBuilder(): Promise<SodiumUserOpBuilder> {
    return this.opBuilderPromise;
  }

  getUserOpClient(): Promise<IClient> {
    return this.opClientPromise;
  }

  connect(_: Provider): Wallet {
    throw new Error('Wallet provider argument is expected to be a JsonRpcProvider');
  }

  setBundler(bundlerUrl: string, chainId: number): Wallet {
    this.bundlerURL = bundlerUrl;
    this.chainId = chainId;
    return this;
  }

  initEIP4337(): Wallet {
    if (!this.bundlerURL) {
      throw new Error('bundlerURL is not set');
    }
    if (!this.provider.connection.url) {
      throw new Error('provider url is not set');
    }

    this.opBuilderPromise = this.newUserOpBuilder();

    this.opClientPromise = Client.init(
      this.bundlerURL,
      this.provider.connection.url,
      this.context.entryPointAddress,
    );

    return this;
  }

  // setProvider assigns a json-rpc provider to this wallet instance
  setProvider(
    provider: EthJsonRpcProvider | ConnectionInfo | string,
    network?: NetworkConfig
  ): Wallet {
    if (provider === undefined) return this
    if (Provider.isProvider(provider)) {
      this.provider = provider
      this.sender = new JsonRpcSender(provider)
    } else {
      const jsonProvider = new JsonRpcProvider(<ConnectionInfo | string>provider)
      this.provider = jsonProvider
      this.sender = new JsonRpcSender(jsonProvider)
    }
    this.chainId = network?.chainId;
    if (network) {
      this.network = network;
    }
    return this
  }

  async getProvider(chainId?: number): Promise<EthJsonRpcProvider> {
    if (chainId) await this.getChainIdNumber(chainId)
    return this.provider
  }

  async getWalletContext(chainId?: ChainIdLike): Promise<SodiumContext> {
    return this.context
  }

  async getWalletConfig(chainId?: ChainIdLike): Promise<WalletConfig[]> {
    chainId = await this.getChainIdNumber(chainId)
    const config = {
      ...this.config,
      chainId
    }
    return [config]
  }

  async getWalletState(_?: ChainIdLike): Promise<WalletState[]> {
    const [address, chainId, isDeployed, entryPointAddress, singlotion, handler] = await Promise.all([
      this.getAddress(),
      this.getChainId(),
      this.isDeployed(),
      this.getEntrypointAddress(),
      this.getSinglotonAddress(),
      this.getCurrentHandler(),
    ])
    const state: WalletState = {
      context: this.context,
      config: this.config,
      entrypoint: entryPointAddress,
      singlotion: singlotion,
      address: address,
      handler: handler,
      chainId: chainId,
      deployed: isDeployed,
    }
    return [state]
  }

  async newUserOpBuilder(
    chainId?: ChainIdLike,
  ): Promise<SodiumUserOpBuilder> {
    let opBuilderPromise: Promise<SodiumUserOpBuilder>;
    const isDeployed = await this.isDeployed();
    if (this.sodiumNetworkAuthProof) {
      opBuilderPromise = SodiumUserOpBuilder.initWithSession(
        this.context,
        this.config,
        this._signer,
        this.sodiumNetworkAuthProof.addSessionStruct!,
        this.sodiumNetworkAuthProof.authProof,
        this.bundlerURL,
        this.provider.connection.url,
        isDeployed,
        this.isDelegate(),
      );
    } else {
      opBuilderPromise = SodiumUserOpBuilder.initWithEOA(
        this.context,
        this.config,
        this._signer,
        this.bundlerURL,
        this.provider.connection.url,
        isDeployed,
        this.isDelegate(),
      );
    }

    const opBuilder = await opBuilderPromise;

    if (this.isDelegate()) {
      const signerAddress = await this._signer.getAddress();
      const trusteeAddress = this.delegateProof!.trustee;
      if (signerAddress.toLowerCase() !== trusteeAddress.toLowerCase()) {
        throw new Error(`Signer address ${signerAddress} does not match trustee address ${trusteeAddress}`);
      }
    }

    opBuilder.setSignFunc(this.sodiumInternalSignature.bind(this));

    return opBuilder;
  }

  async getWalletUpgradeTransactions(_?: ChainIdLike): Promise<Transaction[]> {
    const currentSingletonAddress = await this.getSinglotonAddress();
    const walletAddress = await this.getAddress();
    const eqNotf = (a: string, b: string) => a.toLowerCase() !== b.toLowerCase();
    const sointerface = Sodium__factory.createInterface();
    const txs: Transaction[] = [];
    if (eqNotf(currentSingletonAddress, this.context.singletonAddress)) {
      const abi = sointerface.encodeFunctionData("upgradeTo", [this.context.singletonAddress]);
      txs.push({
        to: walletAddress,
        data: abi,
        op: 0,
      });
    }

    const currentHandlerAddress = await this.getCurrentHandler();
    if (eqNotf(currentHandlerAddress, this.context.fallbackHandlerAddress)) {
      const abi = sointerface.encodeFunctionData("setFallbackHandler", [this.context.fallbackHandlerAddress]);
      txs.push({
        to: walletAddress,
        data: abi,
        op: 0,
      });
    }

    return txs;
  }

  // connected reports if json-rpc provider has been connected
  get connected(): boolean {
    return this.sender !== undefined
  }

  // address returns the address of the wallet account address
  get address(): string {
    return this.config.address;
  }

  // getAddress returns the address of the wallet account address
  //
  // The getAddress method is defined on the AbstractSigner
  async getAddress(): Promise<string> {
    return this.address
  }

  async getEntrypointAddress(): Promise<string> {
    return this.context.entryPointAddress;
  }

  async getSinglotonAddress(): Promise<string> {
    const walletIsDeployed = await this.isDeployed();
    if (!walletIsDeployed) {
      return this.context.singletonAddress;
    }
    const walletSingloton = await this.provider.getStorageAt(this.address, this.address);
    const result = defaultAbiCoder.decode(["address"], walletSingloton);

    if (result.length > 0) {
      return result[0];
    }
    // TODO: should we throw an error here?
    throw new Error("failed to get singlotion address");
  }

  async getCurrentHandler(): Promise<string> {
    const walletIsDeployed = await this.isDeployed();
    if (!walletIsDeployed) {
      return this.context.fallbackHandlerAddress;
    }

    const handlerSlot = "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5";
    const walletSingloton = await this.provider.getStorageAt(this.address, handlerSlot);
    const result = defaultAbiCoder.decode(["address"], walletSingloton);

    if (result.length > 0) {
      return result[0];
    }

    throw new Error("failed to get handler address");
  }

  getLocalSigner(): AbstractSigner {
    return this._signer;
  }

  // chainId returns the network connected to this wallet instance
  async getChainId(): Promise<number> {
    if (this.chainId) return this.chainId
    if (!this.provider) {
      throw new Error('provider is not set, first connect a provider')
    }
    this.chainId = (await this.provider.getNetwork()).chainId
    return this.chainId
  }

  async getNetworks(): Promise<NetworkConfig[]> {
    throw new Error("not implemented wallet getNetworks");
  }

  // getTransactionCount returns the number of transactions (aka nonce)
  //
  // getTransactionCount method is defined on the AbstractSigner
  async getTransactionCount(blockTag?: BlockTag): Promise<number> {
    // TODO
    return 0;
  }

  async waitForUserOpHash(userOpHash: string, confirmations?: number | undefined, timeout?: number | undefined, chainId?: ChainIdLike): Promise<AATransactionReceipt> {
    const client = await this.opClientPromise;
    return client.waitUserOp(userOpHash, confirmations, timeout);
  }

  // sendTransaction will dispatch the transaction to the relayer for submission to the network.
  async sendTransaction(
    transaction: Deferrable<Transactionish>,
    chainId?: ChainIdLike,
    paymasterId?: string,
  ): Promise<TransactionResponse> {
    const xchainId = await this.getChainId();
    // check chain id
    if (chainId && getChainId(chainId) != xchainId) {
      throw new Error(`chainId mismatch, expected ${chainId} but got ${xchainId}`)
    }
    const opBuilder = await this.opBuilderPromise;
    const opClient = await this.opClientPromise;
    const txs = await resolveArrayProperties<Transactionish>(transaction);
    await opBuilder.executeTransactionsWithPaymasterId(txs, paymasterId);

    const response = await opClient.sendUserOperation(opBuilder);
    return {
      ...response,
      wait: (confirmations?: number | undefined): Promise<TransactionReceipt> => {
        return this.waitForUserOpHash(response.userOpHash, confirmations, 0, chainId);
      }
    } as TransactionResponse;
  }

  async simulateHandleOp(userOp: IUserOperation, target: string, data: string): Promise<boolean> {
    const entryPointAddress = await this.getEntrypointAddress();
    const entryPoint = EntryPoint__factory.connect(entryPointAddress, this.provider);
    try {
      await entryPoint.callStatic.simulateHandleOp(userOp, target, data);
    } catch (e) {
      if (e.errorName != "ExecutionResult") {
        throw e;
      }
      return e.errorArgs[4];
    }
    return false;
  }

  async sendUserOperationRaw(
    userOp: IUserOperation,
    chainId?: ChainIdLike,
  ): Promise<TransactionResponse> {
    const xchainId = await this.getChainId();
    // check chain id
    if (chainId && getChainId(chainId) != xchainId) {
      throw new Error(`chainId mismatch, expected ${chainId} but got ${xchainId}`)
    }
    const opBuilder = await this.opBuilderPromise;
    const opClient = await this.opClientPromise;
    const signedUserOp = await opBuilder.signUserOp(userOp);
    const response = await opClient.sendUserOperationRaw(signedUserOp);
    return {
      ...response,
      wait: (confirmations?: number | undefined): Promise<TransactionReceipt> => {
        return this.waitForUserOpHash(response.userOpHash, confirmations, 0, chainId);
      }
    } as TransactionResponse;
  }

  // sendTransactionBatch is a sugar for better readability, but is the same as sendTransaction
  async sendTransactionBatch(
    transactions: Deferrable<TransactionRequest[] | Transaction[]>,
    chainId?: ChainIdLike,
    paymasterId?: string,
  ): Promise<TransactionResponse> {
    return this.sendTransaction(transactions, chainId, paymasterId)
  }

  private async sodiumInternalSignature(message: ethers.utils.Bytes): Promise<string> {
    if (this.delegateProof) {
      return signType2(this._signer, message, this.delegateProof);
    }
    return signType1(this._signer, message);
  }

  async genDelegateProof(trustee: string, delegateExpires: number): Promise<{
    proof: DelegateProof,
    sodiumAuthProof?: SodiumNetworkAuthProof,
    chainId?: ChainIdLike
  }> {
    const address = await this.getAddress();
    const proof = await genDelegateProof(
      address,
      this.config.accountSlat,
      trustee,
      this._signer,
      delegateExpires
    );
    return {
      proof,
      sodiumAuthProof: this.sodiumNetworkAuthProof
    };
  }

  // signMessage will sign a message for a particular chainId with the wallet signers
  // NOTE: signMessage(message: Bytes | string): Promise<string> is defined on AbstractSigner
  async signMessage(message: BytesLike): Promise<string> {
    const data = typeof message === 'string' && !message.startsWith('0x') ? ethers.utils.toUtf8Bytes(message) : message;
    const localSigner = this.getLocalSigner();
    const address = await this.getAddress();
    const isDeployed = await this.isDeployed();

    if (isDeployed) {
      const cfh = CompatibilityFallbackHandler__factory.connect(address, this.provider);
      const signHash = await cfh.getMessageHash(data);
      const hash = ethers.utils.arrayify(signHash);
      return this.sodiumInternalSignature(hash);
    }

    // / TODO
    // / Support check for non deployed wallets
    const sig = await localSigner.signMessage(data);
    return ethers.utils.hexConcat([sig, this.config.accountSlat]);
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    message: Record<string, any>,
    chainId?: ChainIdLike,
  ): Promise<string> {
    const signChainId = await this.getChainIdNumber(chainId)
    const domainChainId = domain.chainId ? BigNumber.from(domain.chainId).toNumber() : undefined
    if (domainChainId && domainChainId !== signChainId) {
      throw new Error(`signTypedData: domain.chainId (${domain.chainId}) is expected to be ${signChainId}`)
    }
    const hash = encodeTypedDataDigest({ domain, types, message })
    return this.signMessage(hash);
  }

  async _signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    message: Record<string, any>,
    chainId?: ChainIdLike,
  ): Promise<string> {
    return this.signTypedData(domain, types, message, chainId)
  }

  async subDigest(digest: BytesLike, chainId?: ChainIdLike): Promise<Uint8Array> {
    const solvedChainId = await this.getChainIdNumber(chainId)
    return ethers.utils.arrayify(subDigestOf(this.address, solvedChainId, digest))
  }

  async getBalance(chainId?: ChainIdLike, blockTag?: BlockTag | undefined): Promise<BigNumber> {
    return this.provider.getBalance(this.address, blockTag);
  }

  async isDeployed(chainId?: ChainIdLike, blockTag?: BlockTag | undefined): Promise<boolean> {
    if (this._isDeployed === true) {
      return true;
    }
    await this.getChainIdNumber(chainId)
    const walletCode = await this.provider.getCode(this.address, blockTag)
    const rv = !!walletCode && walletCode !== '0x';
    if (rv) {
      this._isDeployed = true;
      return true;
    }
    return false;
  }

  isDelegate(): boolean {
    return this.delegateProof !== undefined;
  }

  // getChainIdFromArgument will return the chainId of the argument, as well as ensure
  // we're not providing an invalid chainId that isn't connected to this wallet.
  private async getChainIdNumber(chainId?: ChainIdLike): Promise<number> {
    if (!chainId) {
      // it's valid for chainId argument to be undefined, in which case
      // we will use the connected value
      return await this.getChainId()
    }

    const id = getChainId(chainId);

    const connectedChainId = await this.getChainId()
    if (connectedChainId !== id) {
      throw new Error(`the specified chainId ${id} does not match the wallet's connected chainId ${connectedChainId}`)
    }

    return connectedChainId
  }

  signTransaction(_: Deferrable<TransactionRequest>): Promise<string> {
    throw new Error('signTransaction method is not supported in Wallet, please use signTransactions(...)')
  }
}
