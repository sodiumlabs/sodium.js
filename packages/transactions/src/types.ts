import { BigNumber, BigNumberish, BytesLike } from 'ethers';
import { TransactionRequest as EthersTransactionRequest, TransactionResponse as EthersTransactionResponse } from '@ethersproject/providers';
import { UserOperationStruct } from '@0xsodium/wallet-contracts/gen/adapter/contracts/eip4337/interfaces/IAccount';
import { TransactionStruct } from '@0xsodium/wallet-contracts/gen/adapter/contracts/Sodium';

export interface Transaction {
  to: string
  value?: BigNumberish
  data: BytesLike
  gasLimit?: BigNumberish
  op?: BigNumberish
  revertOnError?: boolean
}

export interface TransactionEncoded extends TransactionStruct {
  op: BigNumberish
  revertOnError: boolean
  gasLimit: BigNumberish
  target: string
  value: BigNumberish
  data: BytesLike
}

export interface TransactionRequest extends EthersTransactionRequest {
  auxiliary?: Transactionish[]
}

export interface SignedTransaction extends UserOperationStruct {
  transactions: Transaction[]
}

export interface NonceDependency {
  address: string
  nonce: BigNumberish
  space?: BigNumberish
}

export type Transactionish = TransactionRequest | TransactionRequest[] | Transaction | Transaction[]

export interface TransactionResponse<R = any> extends EthersTransactionResponse {
  receipt?: R
}

export type GasPrice = {
  maxPriorityFeePerGas: BigNumber,
  maxFeePerGas: BigNumber
}
export type GasSuggest = {
  standard: GasPrice,
  fast: GasPrice,
  rapid: GasPrice
}