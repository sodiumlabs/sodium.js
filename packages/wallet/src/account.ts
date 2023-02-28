import { JsonRpcProvider, Provider, TransactionResponse, TransactionReceipt, BlockTag } from '@ethersproject/providers';
import { Signer as AbstractSigner, BytesLike, BigNumber } from 'ethers';
import { TypedDataDomain, TypedDataField } from '@ethersproject/abstract-signer';
import { Deferrable } from '@ethersproject/properties';
import { Signer } from './signer';
import {
  Transactionish,
  SignedTransaction,
  Transaction,
  TransactionRequest
} from '@0xsodium/transactions';
import {
  WalletConfig,
  WalletState
} from '@0xsodium/config';
import {
  ChainIdLike,
  NetworkConfig,
  WalletContext,
  sodiumContext,
  mainnetNetworks,
  ensureValidNetworks,
  getChainId,
  sortNetworks
} from '@0xsodium/network';
import { Wallet } from './wallet';
import { encodeTypedDataDigest, encodeTypedDataHash } from '@0xsodium/utils';
import { PaymasterInfo } from '@0xsodium/sdk4337';

export interface AccountOptions {
  initialConfig: WalletConfig
  networks?: NetworkConfig[]
  context?: WalletContext
}

// Account is an interface to a multi-network smart contract wallet.
export class Account extends Signer {
  private readonly options: AccountOptions

  private _wallets: {
    wallet: Wallet
    network: NetworkConfig
  }[]

  private _signers: (BytesLike | AbstractSigner)[]

  // provider points at the main chain for compatability with the Signer.
  // Use getProvider(chainId) to get the provider for the respective network.
  provider: JsonRpcProvider

  // memoized value
  private _chainId?: number

  constructor(options: AccountOptions, ...signers: (BytesLike | AbstractSigner)[]) {
    super()

    this.options = options
    this._signers = signers

    if (!this.options.context) {
      this.options.context = sodiumContext;
    }

    // Network config, defaults will be used if none are provided
    if (this.options.networks) {
      this.setNetworks(this.options.networks)
    } else {
      this.setNetworks([...mainnetNetworks])
    }
  }

  async getWalletContext(): Promise<WalletContext> {
    return this.options.context!
  }

  // getWalletConfig builds a list of WalletConfigs across all networks.
  // This is useful to shows all keys/devices connected to a wallet across networks.
  async getWalletConfig(chainId?: ChainIdLike): Promise<WalletConfig[]> {
    let wallets: { wallet: Wallet; network: NetworkConfig }[] = []
    if (chainId) {
      const v = this.getWalletByNetwork(chainId)
      if (v) {
        wallets.push(v)
      }
    } else {
      wallets = this._wallets
    }
    return (await Promise.all(wallets.map(w => w.wallet.getWalletConfig()))).flat()
  }

  async getWalletState(chainId?: ChainIdLike): Promise<WalletState[]> {
    let wallets: { wallet: Wallet; network: NetworkConfig }[] = []
    if (chainId) {
      const v = this.getWalletByNetwork(chainId)
      if (v) {
        wallets.push(v)
      }
    } else {
      wallets = this._wallets
    }
    const states = (await Promise.all(wallets.map(w => w.wallet.getWalletState()))).flat()
    return states;
  }

  // address getter
  get address(): string {
    return this._wallets[0].wallet.address
  }

  // getAddress returns the address of the wallet -- note the account address is the same
  // across all wallets on all different networks
  getAddress(): Promise<string> {
    return this._wallets[0].wallet.getAddress()
  }

  // getSigners returns the multi-sig signers with permission to control the wallet
  async getSigners(): Promise<string[]> {
    return this._wallets[0].wallet.getSigners()
  }

  async getProvider(chainId?: number): Promise<JsonRpcProvider | undefined> {
    if (!chainId) return this.mainWallet()?.wallet.getProvider()
    return this._wallets.find(w => w.network.chainId === chainId)?.wallet.getProvider()
  }

  async getNetworks(): Promise<NetworkConfig[]> {
    return this.options.networks!
  }

  // NOTE: this is copied over on top of ethers, and is memoized
  async getChainId(): Promise<number> {
    if (this._chainId) return this._chainId
    const network = await this.provider.getNetwork()
    this._chainId = network.chainId
    return this._chainId
  }

  getAuthChainId(): number {
    try {
      return this.options.networks!.find(network => network.isAuthChain)!.chainId
    } catch {
      throw new Error('no auth network')
    }
  }

  async signMessage(
    message: BytesLike,
    target?: Wallet | ChainIdLike,
  ): Promise<string> {
    const { wallet } = await (async () => {
      // eslint-disable-line
      if (!target) {
        return this.mainWallet()
      }
      if ((<Wallet>target).address) {
        const chainId = await (<Wallet>target).getChainId()
        return this.getWalletByNetwork(chainId)
      }
      return this.getWalletByNetwork(target as ChainIdLike)
    })()
    return wallet.signMessage(message)
  }

  async signAuthMessage(message: BytesLike): Promise<string> {
    return this.signMessage(message, this.authWallet()?.wallet)
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    message: Record<string, any>,
    chainId?: ChainIdLike,
  ): Promise<string> {
    const wallet = chainId ? this.getWalletByNetwork(chainId).wallet : this.mainWallet().wallet
    const digest = encodeTypedDataHash({ domain, types, message })
    return this.signMessage(digest, wallet)
  }

  async _signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    message: Record<string, any>,
    chainId?: ChainIdLike,
  ): Promise<string> {
    return this.signTypedData(domain, types, message, chainId)
  }

  async sendTransaction(
    dtransactionish: Deferrable<Transactionish>,
    chainId?: ChainIdLike,
    paymasterId?: string,
  ): Promise<TransactionResponse> {
    const wallet = chainId ? this.getWalletByNetwork(chainId).wallet : this.mainWallet().wallet
    return wallet.sendTransaction(dtransactionish, chainId, paymasterId);
  }

  waitForTransaction(transactionHash: string, confirmations?: number | undefined, timeout?: number | undefined, chainId?: ChainIdLike): Promise<TransactionReceipt> {
    const wallet = chainId ? this.getWalletByNetwork(chainId).wallet : this.mainWallet().wallet
    return wallet.waitForTransaction(transactionHash, confirmations, timeout);
  }

  getBalance(chainId?: ChainIdLike, blockTag?: BlockTag | undefined): Promise<BigNumber> {
    const wallet = chainId ? this.getWalletByNetwork(chainId).wallet : this.mainWallet().wallet
    return wallet.getBalance(chainId, blockTag);
  }

  async sendTransactionBatch(
    transactions: Deferrable<TransactionRequest[] | Transaction[]>,
    chainId?: ChainIdLike,
    paymasterId?: string,
  ): Promise<TransactionResponse> {
    return this.sendTransaction(transactions, chainId, paymasterId);
  }

  async signTransactions(
    dtransactionish: Deferrable<Transactionish>,
    chainId?: ChainIdLike
  ): Promise<SignedTransaction> {
    const wallet = chainId ? this.getWalletByNetwork(chainId).wallet : this.mainWallet().wallet
    return wallet.signTransactions(dtransactionish, chainId)
  }

  async sendSignedTransactions(
    signedTxs: SignedTransaction, 
    chainId?: ChainIdLike,
    paymasterId?: string,
  ): Promise<TransactionResponse> {
    const wallet = chainId ? this.getWalletByNetwork(chainId).wallet : this.mainWallet().wallet
    return wallet.sendSignedTransactions(signedTxs, chainId, paymasterId);
  }

  getPaymasterInfos(transactions: TransactionRequest, chainId?: ChainIdLike): Promise<PaymasterInfo[]> {
    const wallet = chainId ? this.getWalletByNetwork(chainId).wallet : this.mainWallet().wallet
    return wallet.getPaymasterInfos(transactions, chainId)
  }

  async isDeployed(target?: Wallet | ChainIdLike): Promise<boolean> {
    const wallet = (() => {
      if (!target) return this.authWallet().wallet
      if ((<Wallet>target).address) {
        return target as Wallet
      }
      return this.getWalletByNetwork(target as NetworkConfig).wallet
    })()
    return wallet.isDeployed()
  }

  getWallets(): { wallet: Wallet; network: NetworkConfig }[] {
    return this._wallets
  }

  getWalletByNetwork(chainId: ChainIdLike) {
    const networkId = getChainId(chainId)
    const network = this._wallets.find(w => w.network.chainId === networkId)
    if (!network) {
      throw new Error(`network ${chainId} not found in wallets list`)
    }
    return network
  }

  // mainWallet is the DefaultChain wallet
  mainWallet(): { wallet: Wallet; network: NetworkConfig } {
    const found = this._wallets.find(w => w.network.isDefaultChain)
    if (!found) {
      throw new Error('mainWallet not found')
    }
    return found
  }

  // authWallet is the AuthChain wallet
  authWallet(): { wallet: Wallet; network: NetworkConfig } {
    const found = this._wallets.find(w => w.network.isAuthChain)
    if (!found) {
      throw new Error('authChain wallet not found')
    }
    return found
  }

  setNetworks(mainnetNetworks: NetworkConfig[], testnetNetworks: NetworkConfig[] = [], defaultChainId?: string | number): number {
    let networks: NetworkConfig[] = []
    this._chainId = undefined // clear memoized value

    // find chain between mainnet and testnet network groups, and set that network group.
    // otherwise use mainnetNetworks without changes
    if (defaultChainId) {
      // force-convert to a number in case someone sends a number in a string like "1"
      const defaultChainIdNum = parseInt(defaultChainId as any)

      const foundMainnetNetwork = mainnetNetworks.find(n => n.name === defaultChainId || n.chainId === defaultChainIdNum)
      const foundTestnetNetwork = testnetNetworks.find(n => n.name === defaultChainId || n.chainId === defaultChainIdNum)

      if (foundMainnetNetwork || foundTestnetNetwork) {
        if (foundMainnetNetwork) {
          mainnetNetworks.forEach(n => (n.isDefaultChain = false))
          foundMainnetNetwork.isDefaultChain = true
          networks = mainnetNetworks
        } else if (foundTestnetNetwork) {
          testnetNetworks.forEach(n => (n.isDefaultChain = false))
          foundTestnetNetwork.isDefaultChain = true
          networks = testnetNetworks
        }
      } else {
        throw new Error(`unable to set default network as chain '${defaultChainId}' does not exist`)
      }
    } else {
      networks = mainnetNetworks
    }

    // assign while validating network list
    // TODO - we should remove sortNetworks in the future but this is a breaking change
    this.options.networks = ensureValidNetworks(sortNetworks(networks))

    // Account/wallet instances using the initial configuration and network list
    //
    // TODO: we can make an optimization where if mainnetNetworks and testnetNetworks lists
    // haven't changed between calls, and only the defaultChainId, as well, the group between
    // mainnet vs testnet has not changed either -- aka just defaultChainId within a group,
    // then we can avoid rebuilding all of these objects and instead just sort them
    this._wallets = this.options.networks.map(network => {
      const wallet = new Wallet(
        {
          config: this.options.initialConfig,
          context: this.options.context
        },
        ...this._signers
      )

      if (network.provider) {
        wallet.setProvider(network.provider, network)
      } else if (network.rpcUrl && network.rpcUrl !== '') {
        wallet.setProvider(network.rpcUrl, network)
      } else {
        throw new Error(`network config is missing provider settings for chainId ${network.chainId}`)
      }

      if (network.bundlerUrl) {
        wallet.setBundler(network.bundlerUrl, network.chainId);
      } else {
        throw new Error(`network config is missing bundler settings for chainId ${network.chainId}`)
      }

      if (network.isDefaultChain) {
        this._chainId = network.chainId
        this.provider = wallet.provider
      }
      return {
        network: network,
        wallet: wallet
      }
    })

    // return the default chain id as number
    return this.options.networks.find(network => network.isDefaultChain)!.chainId
  }

  connect(_: Provider): AbstractSigner {
    throw new Error('connect method is not supported in MultiWallet')
  }

  signTransaction(_: Deferrable<TransactionRequest>): Promise<string> {
    throw new Error('signTransaction method is not supported in MultiWallet, please use signTransactions(...)')
  }
}
