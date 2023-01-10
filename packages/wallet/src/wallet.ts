import { Provider, BlockTag, JsonRpcProvider as EthJsonRpcProvider, TransactionResponse } from '@ethersproject/providers'
import { BigNumber, BigNumberish, ethers, Signer as AbstractSigner } from 'ethers';
import { TypedDataDomain, TypedDataField } from '@ethersproject/abstract-signer';
import { BytesLike } from '@ethersproject/bytes';
import { Deferrable } from '@ethersproject/properties';
import { ConnectionInfo } from '@ethersproject/web';
import {
  decodeNonce,
  Transactionish,
  TransactionRequest,
  SignedTransaction,
  Transaction
} from '@0xsodium/transactions';
import { PaymasterInfo, WalletAPI } from '@0xsodium/sdk4337';

import {
  ChainIdLike,
  WalletContext,
  JsonRpcSender,
  NetworkConfig,
  isJsonRpcProvider,
  JsonRpcProvider,
  sodiumContext,
  getChainId,
} from '@0xsodium/network';

import {
  WalletConfig,
  WalletState,
  addressOf,
  sortConfig,
  imageHash,
} from '@0xsodium/config';
import { encodeTypedDataDigest, subDigestOf } from '@0xsodium/utils';
import { RemoteSigner } from './remote-signers';
import { resolveArrayProperties } from './utils';
import { Signer } from './signer';
import { Sodium__factory } from '@0xsodium/wallet-contracts';

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
  context?: WalletContext

  // strict mode will ensure the WalletConfig is usable otherwise throw (on by default)
  strict?: boolean
}

export class Wallet extends Signer {
  readonly context: WalletContext
  readonly config: WalletConfig

  private readonly _signers: AbstractSigner[]

  // provider is an Ethereum Json RPC provider that is connected to a particular network (aka chain)
  // and access to the signer for signing transactions.
  provider: EthJsonRpcProvider

  // sender is a minimal Json RPC sender interface. It's here for convenience for other web3
  // interfaces to use.
  sender: JsonRpcSender

  wallet4337API: WalletAPI

  // relayer dispatches transactions to an Ethereum node directly
  // or through a remote transaction Web Service.
  // relayer: Relayer

  // chainId is the node network id, used for memoization
  chainId?: number

  _isDeployed?: boolean

  constructor(options: WalletOptions, ...signers: (BytesLike | AbstractSigner)[]) {
    super()

    const { config, context, strict } = options

    if (context) {
      this.context = { ...context }
    } else {
      // default context is to use @0xsequence/network deployed context
      this.context = { ...sodiumContext }
    }

    if (strict === true) {
      this.context.nonStrict = undefined
    } else if (strict === false) {
      this.context.nonStrict = true
    }
    // if (!this.context.nonStrict && !isUsableConfig(config)) {
    //   throw new Error('wallet config is not usable (strict mode)')
    // }
    this.config = sortConfig(config)
    this._signers = signers.map(s => (AbstractSigner.isSigner(s) ? s : new ethers.Wallet(s)))

    // cache wallet config for future imageHash lookups
    this.imageHash;

    const localSigner = this.getLocalSigner();

    this.wallet4337API = new WalletAPI({
      signer: localSigner,
      entryPointAddress: this.context.entryPointAddress,
      config: this.config,
      context: this.context
    });
  }

  async init(): Promise<void> {
    await this.wallet4337API.init();
  }

  connect(provider: Provider): Wallet {
    if (isJsonRpcProvider(provider)) {
      return new Wallet({ config: this.config, context: this.context }, ...this._signers)
        .setProvider(provider);
    } else {
      throw new Error('Wallet provider argument is expected to be a JsonRpcProvider')
    }
  }

  getPaymasterInfos(transactions: TransactionRequest, chainId?: ChainIdLike): Promise<PaymasterInfo[]> {
    return this.wallet4337API.getPaymasterInfos(transactions);
  }

  waitForTransaction(transactionHash: string, confirmations?: number | undefined, timeout?: number | undefined): Promise<ethers.providers.TransactionReceipt> {
    return this.wallet4337API.waitForTransaction(transactionHash, confirmations, timeout);
  }

  setBundler(bundlerUrl: string, chainId: number): Wallet {
    this.wallet4337API.setBundler(bundlerUrl, chainId);
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
      const jsonProvider = new EthJsonRpcProvider(<ConnectionInfo | string>provider, network?.chainId)
      this.provider = jsonProvider
      this.sender = new JsonRpcSender(jsonProvider)
    }
    this.chainId = network?.chainId;
    this.wallet4337API.setProvider(this.provider);
    return this
  }

  async getProvider(chainId?: number): Promise<EthJsonRpcProvider> {
    if (chainId) await this.getChainIdNumber(chainId)
    return this.provider
  }

  async getWalletContext(): Promise<WalletContext> {
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
    const [address, chainId, isDeployed] = await Promise.all([this.getAddress(), this.getChainId(), this.isDeployed()])
    const state: WalletState = {
      context: this.context,
      config: this.config,
      address: address,
      chainId: chainId,
      deployed: isDeployed,
      imageHash: this.imageHash,
    }
    return [state]
  }

  // connected reports if json-rpc provider has been connected
  get connected(): boolean {
    return this.sender !== undefined
  }

  // address returns the address of the wallet account address
  get address(): string {
    return addressOf(this.config, this.context, true)
  }

  // imageHash is the unique hash of the WalletConfig
  get imageHash(): string {
    return imageHash(this.config)
  }

  // getAddress returns the address of the wallet account address
  //
  // The getAddress method is defined on the AbstractSigner
  async getAddress(): Promise<string> {
    return this.address
  }

  // getSigners returns the list of public account addresses to the currently connected
  // signer objects for this wallet. Note: for a complete list of configured signers
  // on the wallet, query getWalletConfig()
  async getSigners(): Promise<string[]> {
    if (!this._signers || this._signers.length === 0) {
      return [];
    }
    return Promise.all(this._signers.map(s => s.getAddress().then(s => ethers.utils.getAddress(s))))
  }

  getLocalSigner(): AbstractSigner {
    const localSigners = this._signers.filter(s => !RemoteSigner.isRemoteSigner(s));
    if (localSigners.length == 0) {
      throw new Error("not found local signer");
    }
    return localSigners[0];
  }

  // chainId returns the network connected to this wallet instance
  async getChainId(): Promise<number> {
    if (this.chainId) return this.chainId
    if (!this.provider) {
      throw new Error('provider is not set, first connect a provider')
    }
    this.chainId = (await this.provider.getNetwork()).chainId
    console.debug("request chainId");
    return this.chainId
  }

  async getNetworks(): Promise<NetworkConfig[]> {
    const chainId = await this.getChainId()
    return [
      {
        chainId: chainId,
        name: '',
        rpcUrl: ''
      }
    ]
  }

  // getNonce returns the transaction nonce for this wallet, via the relayer
  async getNonce(blockTag?: BlockTag, space?: BigNumberish): Promise<BigNumberish> {
    // return this.relayer.getNonce(this.config, this.context, space, blockTag)
    return 0;
  }

  // getTransactionCount returns the number of transactions (aka nonce)
  //
  // getTransactionCount method is defined on the AbstractSigner
  async getTransactionCount(blockTag?: BlockTag): Promise<number> {
    const encodedNonce = await this.getNonce(blockTag, 0)
    const [_, decodedNonce] = decodeNonce(encodedNonce)
    return ethers.BigNumber.from(decodedNonce).toNumber()
  }

  // sendTransaction will dispatch the transaction to the relayer for submission to the network.
  async sendTransaction(
    transaction: Deferrable<Transactionish>,
    chainId?: ChainIdLike,
    paymasterId?: string,
  ): Promise<TransactionResponse> {
    const signedTxs = await this.signTransactions(transaction, chainId);
    const tr = await this.wallet4337API.sendSignedTransaction(signedTxs);
    // const receipt = await tr.wait();
    // console.debug(receipt.transactionHash, "receipt.transactionHash")
    // tr.hash = receipt.transactionHash;
    return tr;
  }

  // sendTransactionBatch is a sugar for better readability, but is the same as sendTransaction
  async sendTransactionBatch(
    transactions: Deferrable<TransactionRequest[] | Transaction[]>,
    chainId?: ChainIdLike,
    paymasterId?: string,
  ): Promise<TransactionResponse> {
    return this.sendTransaction(transactions, chainId, paymasterId)
  }

  // signTransactions will sign a Sequence transaction with the wallet signers
  //
  // NOTE: the txs argument of type Transactionish can accept one or many transactions.
  async signTransactions(
    txs1: Deferrable<Transactionish>,
    chainId?: ChainIdLike
  ): Promise<SignedTransaction> {
    const signChainId = await this.getChainIdNumber(chainId);
    const txs = await resolveArrayProperties<Transactionish>(txs1);
    if (!this.provider) {
      throw new Error('missing provider');
    }
    return this.wallet4337API.signTransactions(txs, signChainId);
  }

  async sendSignedTransactions(
    signedTxs: SignedTransaction, 
    chainId?: ChainIdLike,
    paymasterId?: string
  ): Promise<TransactionResponse> {
    await this.getChainIdNumber(chainId)
    return this.wallet4337API.sendSignedTransaction(signedTxs);
  }

  // signMessage will sign a message for a particular chainId with the wallet signers
  // NOTE: signMessage(message: Bytes | string): Promise<string> is defined on AbstractSigner
  async signMessage(message: BytesLike): Promise<string> {
    const data = typeof message === 'string' && !message.startsWith('0x') ? ethers.utils.toUtf8Bytes(message) : message;
    const localSigners = this._signers.filter(s => !RemoteSigner.isRemoteSigner(s));
    if (localSigners.length == 0) {
      throw new Error("not found local signer");
    }
    return localSigners[0].signMessage(data);
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
    if (await this.isDeployed(chainId, blockTag)) {
      const sodium = Sodium__factory.connect(this.address, this.provider);
      return sodium.balanceOf({
        blockTag: blockTag
      });
    }
    return this.provider.getBalance(this.address, blockTag);
  }

  async isDeployed(chainId?: ChainIdLike, blockTag?: BlockTag | undefined): Promise<boolean> {
    await this.getChainIdNumber(chainId)
    const walletCode = await this.provider.getCode(this.address, blockTag)
    const rv = !!walletCode && walletCode !== '0x';
    if (this._isDeployed == true) {
      return true;
    }
    if (rv) {
      this._isDeployed = true;
      return true;
    }
    return false;
  }

  // getChainIdFromArgument will return the chainId of the argument, as well as ensure
  // we're not providing an invalid chainId that isn't connected to this wallet.
  private async getChainIdNumber(chainId?: ChainIdLike): Promise<number> {
    if (!chainId) {
      // it's valid for chainId argument to be undefined, in which case
      // we will use the connected value
      return await this.getChainId()
    }

    const id = getChainId(chainId)

    if (this.context.nonStrict) {
      // in non-strict mode, just return the chainId from argument
      return id
    }

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
