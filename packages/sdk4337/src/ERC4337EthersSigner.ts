import { Deferrable, defineReadOnly } from '@ethersproject/properties';
import { Provider, TransactionRequest, TransactionResponse } from '@ethersproject/providers';
import { Signer } from '@ethersproject/abstract-signer';

import { Bytes } from 'ethers';
import { ERC4337EthersProvider } from './ERC4337EthersProvider';
import { ClientConfig } from './ClientConfig';
import { HttpRpcClient } from './HttpRpcClient';
import type { UserOperationStruct } from '@0xsodium/wallet-contracts/gen/EntryPoint';
import { BaseWalletAPI } from './BaseWalletAPI';

export class ERC4337EthersSigner extends Signer {
  constructor(
    readonly config: ClientConfig,
    readonly originalSigner: Signer,
    readonly erc4337provider: ERC4337EthersProvider,
    readonly httpRpcClient: HttpRpcClient,
    readonly smartWalletAPI: BaseWalletAPI
  )
  {
    super()
    defineReadOnly(this, 'provider', erc4337provider)
  }

  address?: string

  // This one is called by Contract. It signs the request and passes in to Provider to be sent.
  async sendTransaction(transaction: Deferrable<TransactionRequest>): Promise<TransactionResponse> {
    const chainId = await this.erc4337provider.getNetwork().then(n => n.chainId);
    const tx: TransactionRequest = await this.populateTransaction(transaction)
    await this.verifyAllNecessaryFields(tx);
    const userOperation = await this.smartWalletAPI.createSignedUserOp(tx, chainId);
    const transactionResponse = await this.erc4337provider.constructUserOpTransactionResponse(userOperation)
    try {
      await this.httpRpcClient.sendUserOpToBundler(userOperation)
    } catch (error: any) {
      throw this.unwrapError(error)
    }
    // TODO: handle errors - transaction that is "rejected" by bundler is _not likely_ to ever resolve its "wait()"
    return transactionResponse
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

  async verifyAllNecessaryFields(transactionRequest: TransactionRequest): Promise<void> {
    if (transactionRequest.to == null) {
      throw new Error('Missing call target')
    }
    if (transactionRequest.data == null && transactionRequest.value == null) {
      // TBD: banning no-op UserOps seems to make sense on provider level
      throw new Error('Missing call data or value')
    }
  }

  connect(provider: Provider): Signer {
    throw new Error('changing providers is not supported')
  }

  async getAddress(): Promise<string> {
    if (this.address == null) {
      this.address = await this.erc4337provider.getSenderWalletAddress()
    }
    return this.address
  }

  async signMessage(message: Bytes | string): Promise<string> {
    return await this.originalSigner.signMessage(message)
  }

  async signTransaction(transaction: Deferrable<TransactionRequest>): Promise<string> {
    throw new Error('not implemented')
  }

  async signUserOperation(userOperation: UserOperationStruct): Promise<string> {
    const chainId = await this.erc4337provider.getNetwork().then(n => n.chainId);
    const message = await this.smartWalletAPI.getRequestId(userOperation, chainId);
    return await this.originalSigner.signMessage(message)
  }
}
