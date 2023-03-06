import { ethers, BigNumber, BigNumberish } from 'ethers';
import { JsonRpcProvider, Provider, TransactionReceipt, TransactionResponse } from '@ethersproject/providers';
import {
  EntryPoint, EntryPoint__factory,
  SenderCreator, SenderCreator__factory
} from '@0xsodium/wallet-contracts';
import type {
  UserOperationStruct
} from '@0xsodium/wallet-contracts/gen/adapter/contracts/eip4337/core/EntryPoint';
import { TransactionDetailsForUserOp } from './TransactionDetailsForUserOp';
import { hexValue, resolveProperties } from 'ethers/lib/utils';
import { PaymasterAPI } from './PaymasterAPI';
import { getRequestId, NotPromise, packUserOp } from '@0xsodium/utils';
import { calcPreVerificationGas, GasOverheads } from './calcPreVerificationGas';
import { getFeeData, toUserOp, SignedTransaction, flattenAuxTransactions, Transaction } from '@0xsodium/transactions';
import { HttpRpcClient } from './HttpRpcClient';
import { WalletConfig } from '@0xsodium/config';
import { WalletContext } from '@0xsodium/network';
import { UserOperationEventListener } from './UserOperationEventListener';

export interface BaseApiParams {
  entryPointAddress: string
  overheads?: Partial<GasOverheads>
  config: WalletConfig,
  context: WalletContext,
  paymasterAPI?: PaymasterAPI
}

export interface UserOpResult {
  transactionHash: string
  success: boolean
}

/**
 * Base class for all Smart Wallet ERC-4337 Clients to implement.
 * Subclass should inherit 5 methods to support a specific wallet contract:
 *
 * - getWalletInitCode - return the value to put into the "initCode" field, if the wallet is not yet deployed. should create the wallet instance using a factory contract.
 * - getNonce - return current wallet's nonce value
 * - encodeExecute - encode the call from entryPoint through our wallet to the target contract.
 * - signRequestId - sign the requestId of a UserOp.
 *
 * The user can use the following APIs:
 * - createUnsignedUserOp - given "target" and "calldata", fill userOp to perform that operation from the wallet.
 * - createSignedUserOp - helper to call the above createUnsignedUserOp, and then extract the requestId and sign it
 */
export abstract class BaseWalletAPI {
  private senderAddress!: string
  private isPhantom = true

  walletConfig: WalletConfig;
  walletContext: WalletContext;

  chainId: number;
  provider: JsonRpcProvider
  overheads?: Partial<GasOverheads>
  walletAddress?: string
  paymasterAPI?: PaymasterAPI
  httpRpcClient: HttpRpcClient

  /**
   * base constructor.
   * subclass SHOULD add parameters that define the owner (signer) of this wallet
   */
  protected constructor(params: BaseApiParams) {
    this.overheads = params.overheads;
    this.walletConfig = params.config;
    this.walletContext = params.context;
    // this.paymasterAPI = params.paymasterAPI;
    this.paymasterAPI = new PaymasterAPI();
  }

  // async init(): Promise<this> {
  //   if (await this.provider.getCode(this.entryPointAddress) === '0x') {
  //     throw new Error(`entryPoint not deployed at ${this.entryPointAddress}`)
  //   }
  //   await this.getWalletAddress()
  //   return this
  // }

  setProvider(provider: JsonRpcProvider): void {
    this.provider = provider;
  }

  setBundler(bundlerUrl: string, chainId: number) {
    this.httpRpcClient = new HttpRpcClient(bundlerUrl, chainId);
    this.chainId = chainId;
  }

  /**
   * return the value to put into the "initCode" field, if the wallet is not yet deployed.
   * this value holds the "factory" address, followed by this wallet's information
   */
  abstract getWalletInitCode(): Promise<string>

  /**
   * return current wallet's nonce.
   */
  abstract getNonce(): Promise<BigNumber>

  // encode the call from entryPoint through our wallet to the target contract.
  abstract encodeExecute(entryPointAddress: string, transactions: TransactionDetailsForUserOp): Promise<string>

  abstract encodeGasLimit(entryPointAddress: string, transactions: TransactionDetailsForUserOp): Promise<[Transaction[], BigNumber]>

  /**
   * sign a userOp's hash (requestId).
   * @param requestId
   */
  abstract signRequestId(requestId: string): Promise<string>

  /**
   * check if the wallet is already deployed.
   */
  async checkWalletPhantom(): Promise<boolean> {
    if (!this.isPhantom) {
      // already deployed. no need to check anymore.
      return this.isPhantom
    }
    const senderAddressCode = await this.provider.getCode(this.getWalletAddress())
    if (senderAddressCode.length > 2) {
      // console.log(`SimpleWallet Contract already deployed at ${this.senderAddress}`)
      this.isPhantom = false
    } else {
      // console.log(`SimpleWallet Contract is NOT YET deployed at ${this.senderAddress} - working in "phantom wallet" mode.`)
    }
    return this.isPhantom
  }

  async getEntryPoint(entryPointAddress: string): Promise<EntryPoint> {
    return EntryPoint__factory.connect(entryPointAddress, this.provider);
  }

  /**
   * calculate the wallet address even before it is deployed
   */
  async getCounterFactualAddress(): Promise<string> {
    const initCode = await this.getWalletInitCode()
    // use entryPoint to query wallet address (factory can provide a helper method to do the same, but
    // this method attempts to be generic
    const creator = SenderCreator__factory.connect(this.walletContext.walletCreatorAddress, this.provider);
    return await creator.callStatic.getAddress(initCode);
  }

  /**
   * return initCode value to into the UserOp.
   * (either deployment code, or empty hex if contract already deployed)
   */
  async getInitCode(): Promise<string> {
    if (await this.checkWalletPhantom()) {
      return await this.getWalletInitCode()
    }
    return '0x'
  }

  /**
   * return maximum gas used for verification.
   * NOTE: createUnsignedUserOp will add to this value the cost of creation, if the wallet is not yet created.
   */
  async getVerificationGasLimit(): Promise<BigNumberish> {
    return 100000
  }

  /**
   * should cover cost of putting calldata on-chain, and some overhead.
   * actual overhead depends on the expected bundle size
   */
  async getPreVerificationGas(userOp: Partial<UserOperationStruct>): Promise<number> {
    const p = await resolveProperties(userOp)
    return calcPreVerificationGas(p, this.overheads)
  }

  /**
   * ABI-encode a user operation. used for calldata cost estimation
   */
  packUserOp(userOp: NotPromise<UserOperationStruct>): string {
    return packUserOp(userOp, false)
  }

  async encodeUserOpCallDataAndGasLimit(entryPointAddress: string, detailsForUserOp: TransactionDetailsForUserOp): Promise<{ callData: string, callGasLimit: BigNumber }> {
    const [newTxs, callGasLimit] = await this.encodeGasLimit(entryPointAddress,detailsForUserOp);
    const callData = await this.encodeExecute(entryPointAddress, newTxs)
    return {
      callData,
      callGasLimit
    }
  }

  /**
   * return requestId for signing.
   * This value matches entryPoint.getRequestId (calculated off-chain, to avoid a view call)
   * @param userOp userOperation, (signature field ignored)
   */
  async getRequestId(entryPointAddress: string, userOp: UserOperationStruct, chainId: number): Promise<string> {
    const op = await resolveProperties(userOp);
    return getRequestId(op, entryPointAddress, chainId)
  }

  /**
   * return the wallet's address.
   * this value is valid even before deploying the wallet.
   */
  async getWalletAddress(): Promise<string> {
    if (this.senderAddress == null) {
      if (this.walletAddress != null) {
        this.senderAddress = this.walletAddress
      } else {
        this.senderAddress = await this.getCounterFactualAddress()
      }
    }
    return this.senderAddress;
  }

  async createUnsignedUserOp(entryPointAddress: string, info: TransactionDetailsForUserOp): Promise<UserOperationStruct> {
    const {
      callData,
      callGasLimit
    } = await this.encodeUserOpCallDataAndGasLimit(entryPointAddress, info);
    const initCode = await this.getInitCode();
    let verificationGasLimit = BigNumber.from(await this.getVerificationGasLimit())
    if (initCode.length > 2) {
      // add creation to required verification gas
      const senderCreatorAddress = this.walletContext.walletCreatorAddress;
      const senderCreator = SenderCreator__factory.connect(senderCreatorAddress, this.provider);
      const data = senderCreator.interface.encodeFunctionData("createSender", [
        initCode,
      ]);
      const initEstimate = await this.provider.estimateGas({
        from: this.walletContext.entryPointAddress,
        to: senderCreatorAddress,
        data: data,
        gasLimit: 10e6
      })
      verificationGasLimit = verificationGasLimit.add(initEstimate)
    }
    let {
      maxFeePerGas,
      maxPriorityFeePerGas
    } = getFeeData(info);
    if (maxFeePerGas == null || maxPriorityFeePerGas == null) {
      const feeData = await this.provider.getFeeData()
      const gasPrice = await this.provider.getGasPrice();

      // TODO. how to fast send tx.
      if (maxFeePerGas == null) {
        maxFeePerGas = feeData.maxFeePerGas ? feeData.maxFeePerGas : 0
      }
      if (maxPriorityFeePerGas == null) {
        maxPriorityFeePerGas = gasPrice;
      }

      // fix 
      // max priority fee per gas higher than max fee per gas
      if (BigNumber.from(maxPriorityFeePerGas).gt(maxFeePerGas)) {
        maxPriorityFeePerGas = maxFeePerGas;
      }
    }
    const partialUserOp: any = {
      sender: this.getWalletAddress(),
      nonce: this.getNonce(),
      initCode,
      callData,
      callGasLimit,
      verificationGasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      paymasterAndData: '0x'
    }
    if (this.paymasterAPI != null) {
      // fill (partial) preVerificationGas (all except the cost of the generated paymasterAndData)
      const userOpForPm = {
        ...partialUserOp,
        preVerificationGas: this.getPreVerificationGas(partialUserOp)
      }
      const temp = await this.paymasterAPI.getPaymasterAndData(this.chainId, userOpForPm);
      partialUserOp.paymasterAndData = temp ?? '0x';
    }
    return {
      ...partialUserOp,
      preVerificationGas: this.getPreVerificationGas(partialUserOp),
      signature: '0x'
    };
  }

  /**
   * Sign the filled userOp.
   * @param userOp the UserOperation to sign (with signature field ignored)
   */
  async signUserOp(entrypointAddress: string, userOp: UserOperationStruct, chainId: number): Promise<UserOperationStruct> {
    const requestId = await this.getRequestId(entrypointAddress, userOp, chainId)
    const signature = this.signRequestId(requestId)
    return {
      ...userOp,
      signature
    }
  }
  
  async signTransactions(entryPointAddress: string, info: TransactionDetailsForUserOp, chainId: number): Promise<SignedTransaction> {
    const userOp = await this.createUnsignedUserOp(entryPointAddress, info);
    const requestId = await this.getRequestId(entryPointAddress, userOp, chainId);
    const signature = this.signRequestId(requestId);
    const txs = flattenAuxTransactions(info);
    return {
      ...userOp,
      signature,
      transactions: txs
    }
  }

  /**
   * helper method: create and sign a user operation.
   * @param info transaction details for the userOp
   */
  async createSignedUserOp(entryPointAddress: string, info: TransactionDetailsForUserOp, chainId: number): Promise<UserOperationStruct> {
    return await this.signUserOp(entryPointAddress, await this.createUnsignedUserOp(entryPointAddress, info), chainId);
  }

  /**
   * get the transaction that has this requestId mined, or null if not found
   * @param requestId returned by sendUserOpToBundler (or by getRequestId..)
   * @param timeout stop waiting after this timeout
   * @param interval time to wait between polls.
   * @return the transactionHash this userOp was mined, or null if not found.
   */
  async getUserOpReceipt(entryPointAddress: string, requestId: string, timeout = 30000, interval = 5000): Promise<string | null> {
    const entryPoint = await this.getEntryPoint(entryPointAddress);
    const endtime = Date.now() + timeout
    while (Date.now() < endtime) {
      const events = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(requestId))
      if (events.length > 0) {
        return events[0].transactionHash
      }
      await new Promise(resolve => setTimeout(resolve, interval))
    }
    return null
  }

  unwrapError(errorIn: any): Error {
    if (errorIn.body != null) {
      const errorBody = JSON.parse(errorIn.body)
      let paymasterInfo: string = ''
      let failedOpMessage: string | undefined = errorBody?.error?.message
      if (failedOpMessage?.includes('FailedOp') === true) {
        // TODO: better error extraction methods will be needed
        const matched = failedOpMessage.match(/FailedOp\((.*)\)/)
        if (matched != null) {
          const split = matched[1].split(',')
          paymasterInfo = `(paymaster address: ${split[1]})`
          failedOpMessage = split[2]
        }
      }
      const error = new Error(`The bundler has failed to include UserOperation in a batch: ${failedOpMessage} ${paymasterInfo})`)
      error.stack = errorIn.stack
      return error
    }
    return errorIn
  }

  async sendSignedTransaction(entryPointAddress: string, tx: SignedTransaction) {
    const userOp = toUserOp(tx);
    const transactionResponse = await this.constructUserOpTransactionResponse(entryPointAddress, userOp)
    try {
      const userOpHash = await this.httpRpcClient.sendUserOpToBundler(entryPointAddress, userOp);
      
      // TODO
      // temp impl
      const txHash = await this.httpRpcClient.getTransactionHashByUserOpHash(userOpHash);
      transactionResponse.hash = txHash;
    } catch (error: any) {
      throw this.unwrapError(error)
    }

    return transactionResponse
  }

  async getTransactionReceipt(entryPointAddress: string, transactionHash: string | Promise<string>): Promise<TransactionReceipt> {
    const entryPoint = await this.getEntryPoint(entryPointAddress);
    const requestId = await transactionHash
    const sender = await this.getWalletAddress();
    return await new Promise<TransactionReceipt>((resolve, reject) => {
      new UserOperationEventListener(
        resolve, reject, entryPoint, sender, requestId,
      ).start()
    })
  }

  async waitForTransaction(entryPointAddress: string, transactionHash: string, confirmations?: number, timeout?: number): Promise<TransactionReceipt> {
    const entryPoint = await this.getEntryPoint(entryPointAddress);
    const sender = await this.getWalletAddress()
    return await new Promise<TransactionReceipt>((resolve, reject) => {
      const listener = new UserOperationEventListener(resolve, reject, entryPoint, sender, transactionHash, undefined, timeout)
      listener.start()
    })
  }

  // fabricate a response in a format usable by ethers users...
  async constructUserOpTransactionResponse(entryPointAddress: string, userOp1: UserOperationStruct): Promise<TransactionResponse> {
    const entryPoint = await this.getEntryPoint(entryPointAddress);
    const userOp = await resolveProperties(userOp1)
    const requestId = getRequestId(userOp, entryPointAddress, this.chainId);
    let waitPromise: Promise<TransactionReceipt> | null
    return {
      hash: requestId,
      confirmations: 0,
      from: userOp.sender,
      nonce: BigNumber.from(userOp.nonce).toNumber(),
      gasLimit: BigNumber.from(userOp.callGasLimit), // ??
      value: BigNumber.from(0),
      data: hexValue(userOp.callData.toString()), // should extract the actual called method from this "execFromEntryPoint()" call
      chainId: this.chainId,
      wait: async (confirmations?: number): Promise<TransactionReceipt> => {
        if (!waitPromise) {
          waitPromise = new Promise<TransactionReceipt>((resolve, reject) => {
            new UserOperationEventListener(
              resolve, reject, entryPoint, userOp.sender, requestId, userOp.nonce
            ).start()
          });
        }
        const transactionReceipt = await waitPromise
        if (userOp.initCode.length !== 0) {
          // checking if the wallet has been deployed by the transaction; it must be if we are here
          await this.checkWalletPhantom()
        }
        return transactionReceipt
      }
    }
  }

}
