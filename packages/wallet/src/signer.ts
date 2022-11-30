import { ethers, Signer as AbstractSigner } from 'ethers'
import { TypedDataDomain, TypedDataField } from '@ethersproject/abstract-signer'
import { NetworkConfig, ChainIdLike, WalletContext } from '@0xsodium/network'
import {
  SignedTransaction,
  Transactionish,
  TransactionRequest,
  Transaction
} from '@0xsodium/transactions';
import { JsonRpcProvider, TransactionResponse } from '@ethersproject/providers';
import { BytesLike } from '@ethersproject/bytes';
import { WalletConfig, WalletState } from '@0xsodium/config';
import { Deferrable } from '@0xsodium/utils';

export abstract class Signer extends AbstractSigner {
  abstract getProvider(chainId?: number): Promise<JsonRpcProvider | undefined>
  // abstract getRelayer(chainId?: number): Promise<Relayer | undefined>

  abstract getWalletContext(): Promise<WalletContext>
  abstract getWalletConfig(chainId?: ChainIdLike): Promise<WalletConfig[]>
  abstract getWalletState(chainId?: ChainIdLike): Promise<WalletState[]>

  abstract getNetworks(): Promise<NetworkConfig[]>

  // getSigners returns a list of available / attached signers to the interface. Note: you need
  // enough signers in order to meet the signing threshold that satisfies a wallet config.
  // abstract getSigners(): Promise<string[]>

  // signMessage .....
  abstract signMessage(message: BytesLike, chainId?: ChainIdLike, allSigners?: boolean, isDigest?: boolean): Promise<string>

  // signTypedData ..
  abstract signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    message: Record<string, any>,
    chainId?: ChainIdLike,
    allSigners?: boolean
  ): Promise<string>

  // sendTransaction takes an unsigned transaction, or list of unsigned transactions, and then has it signed by
  // the signer, and finally sends it to the relayer for submission to an Ethereum network.
  abstract sendTransaction(
    transaction: Deferrable<Transactionish>,
    chainId?: ChainIdLike,
  ): Promise<TransactionResponse>

  // sendTransactionBatch provides the ability to send an array/batch of transactions as a single native on-chain transaction.
  // This method works identically to sendTransaction but offers a different syntax for convience, readability and type clarity.
  abstract sendTransactionBatch(
    transactions: Deferrable<TransactionRequest[] | Transaction[]>,
    chainId?: ChainIdLike,
  ): Promise<TransactionResponse>

  // Low-level methods to sign and send/relayer signed transactions separately. The combination of these methods
  // is like calling just sendTransaction(..) above. Also note that sendSignedTransactions is identical
  // to calling getRelayer().relay(signedTxs), but included in this interface for convenience.
  abstract signTransactions(
    txs: Deferrable<Transactionish>,
    chainId?: ChainIdLike,
    allSigners?: boolean
  ): Promise<SignedTransaction>

  abstract sendSignedTransactions(signedTxs: SignedTransaction, chainId?: ChainIdLike): Promise<TransactionResponse>

  // isDeployed ..
  abstract isDeployed(chainId?: ChainIdLike): Promise<boolean>
}

// export function isSequenceSigner(signer: AbstractSigner): signer is Signer {
//   const cand = signer as Signer
//   return (
//     cand &&
//     cand.updateConfig !== undefined &&
//     cand.publishConfig !== undefined &&
//     cand.getWalletContext !== undefined &&
//     cand.getWalletConfig !== undefined
//   )
// }

// TODO: move to error.ts, along with others..
export class InvalidSigner extends Error { }

export class NotEnoughSigners extends Error { }
