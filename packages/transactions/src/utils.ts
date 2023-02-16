import { ethers, BigNumberish } from 'ethers'
import { Transaction, TransactionRequest, Transactionish, TransactionEncoded, NonceDependency, SignedTransaction } from './types'
import { UserOperationStruct } from '@0xsodium/wallet-contracts/gen/adapter/contracts/eip4337/interfaces/IAccount';

type FeeData = {
  maxFeePerGas?: ethers.BigNumberish
  maxPriorityFeePerGas?: ethers.BigNumberish
}

export const MetaTransactionsType = `tuple(
  enum op,
  bool revertOnError,
  uint256 gasLimit,
  address target,
  uint256 value,
  bytes data
)[]`

export function packMetaTransactionsNonceData(nonce: BigNumberish, ...txs: Transaction[]): string {
  return ethers.utils.defaultAbiCoder.encode(['uint256', MetaTransactionsType], [nonce, sodiumTxAbiEncode(txs)])
}

export async function toSodiumTransactions(
  txs: (Transaction | TransactionRequest)[],
  revertOnError: boolean = true,
  gasLimit?: BigNumberish
): Promise<Transaction[]> {
  // Bundles all transactions, including the auxiliary ones
  const allTxs = flattenAuxTransactions(txs)
  // Uses the lowest nonce found on TransactionRequest
  // if there are no nonces, it leaves an undefined nonce
  // Maps all transactions into SequenceTransactions
  return Promise.all(allTxs.map(tx => toSodiumTransaction(tx, revertOnError, gasLimit)))
}

export function flattenAuxTransactions(txs: Transactionish | Transactionish[]): Transaction[] {
  if (!Array.isArray(txs)) {
    if ('auxiliary' in txs) {
      const aux = txs.auxiliary
      const tx = { ...txs }
      delete tx.auxiliary;
      if (aux) {
        return [tx, ...flattenAuxTransactions(aux)] as Transaction[]
      } else {
        return [tx] as Transaction[]
      }
    } else {
      return [txs] as Transaction[]
    }
  }
  return txs.flatMap(flattenAuxTransactions)
}

export function toUserOp(signedTx: SignedTransaction): UserOperationStruct {
  const userOp: UserOperationStruct = {
    sender: signedTx.sender,
    nonce: signedTx.nonce,
    initCode: signedTx.initCode,
    callData: signedTx.callData,
    callGasLimit: signedTx.callGasLimit,
    verificationGasLimit: signedTx.verificationGasLimit,
    preVerificationGas: signedTx.preVerificationGas,
    maxFeePerGas: signedTx.maxFeePerGas,
    maxPriorityFeePerGas: signedTx.maxPriorityFeePerGas,
    paymasterAndData: signedTx.paymasterAndData,
    signature: signedTx.signature
  };
  return userOp;
}

export function getFeeData(txs: Transactionish | Transactionish[]): FeeData {
  if (!Array.isArray(txs)) {
    if ('auxiliary' in txs) {
      return {
        maxFeePerGas: txs.maxFeePerGas,
        maxPriorityFeePerGas: txs.maxPriorityFeePerGas
      }
    }
  }
  return {
    
  }
}

export async function toSodiumTransaction(
  tx: TransactionRequest | Transaction,
  revertOnError: boolean = false,
  gasLimit?: BigNumberish,
): Promise<Transaction> {
  if (isSodiumTransaction(tx)) {
    return tx as Transaction
  }
  const txGas = tx.gasLimit === undefined ? (<any>tx).gas : tx.gasLimit;
  if (!tx.to) {
    throw new Error("tx to invalid");
  }
  return {
    op: 0,
    revertOnError: revertOnError,
    gasLimit: txGas ? await txGas : gasLimit,
    to: await tx.to,
    value: tx.value ? await tx.value : 0,
    data: (await tx.data)!,
  }
}

export function isAsyncSendable(target: any) {
  return target.send || target.sendAsync
}

export function isSodiumTransaction(tx: any): tx is Transaction {
  return tx.op !== undefined || tx.revertOnError !== undefined
}

export function hasSodiumTransactions(txs: any[]) {
  return txs.find(t => isSodiumTransaction(t)) !== undefined
}

export function sodiumTxAbiEncode(txs: Transaction[]): TransactionEncoded[] {
  return txs.map(t => ({
    op: t.op ?? 0,
    revertOnError: t.revertOnError === true,
    gasLimit: t.gasLimit !== undefined ? t.gasLimit : ethers.constants.Zero,
    target: t.to ?? ethers.constants.AddressZero,
    value: t.value !== undefined ? t.value : ethers.constants.Zero,
    data: t.data !== undefined ? t.data : []
  }))
}

export function isSignedTransaction(cand: any): cand is SignedTransaction {
  return (
    cand !== undefined &&
    cand.callGasLimit !== undefined &&
    cand.callData !== undefined &&
    cand.nonce !== undefined &&
    cand.signature !== undefined &&
    Array.isArray(cand.transactions) &&
    (<SignedTransaction>cand).transactions.reduce((p, c) => p && isSodiumTransaction(c), true)
  )
}

export function appendNonce(txs: Transaction[], nonce: BigNumberish): Transaction[] {
  return txs.map((t: Transaction) => ({ ...t, nonce }))
}

export function encodeNonce(space: BigNumberish, nonce: BigNumberish): BigNumberish {
  const bspace = ethers.BigNumber.from(space)
  const bnonce = ethers.BigNumber.from(nonce)

  const shl = ethers.constants.Two.pow(ethers.BigNumber.from(96))

  if (!bnonce.div(shl).eq(ethers.constants.Zero)) {
    throw new Error('Space already encoded')
  }

  return bnonce.add(bspace.mul(shl))
}

export function decodeNonce(nonce: BigNumberish): [BigNumberish, BigNumberish] {
  const bnonce = ethers.BigNumber.from(nonce)
  const shr = ethers.constants.Two.pow(ethers.BigNumber.from(96))
  return [bnonce.div(shr), bnonce.mod(shr)]
}

export async function fromTransactionish(
  transaction: Transactionish
): Promise<Transaction[]> {
  let stx: Transaction[] = []
  if (Array.isArray(transaction)) {
    if (hasSodiumTransactions(transaction)) {
      stx = flattenAuxTransactions(transaction) as Transaction[]
    } else {
      stx = await toSodiumTransactions(transaction)
    }
  } else if (isSodiumTransaction(transaction)) {
    stx = flattenAuxTransactions([transaction]) as Transaction[]
  } else {
    stx = await toSodiumTransactions([transaction])
  }
  return stx
}
