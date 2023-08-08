import { BigNumber, Signer as AbstractSigner } from 'ethers';
import { TypedDataDomain, TypedDataField } from '@ethersproject/abstract-signer';
import { NetworkConfig, ChainIdLike, SodiumContext } from '@0xsodium/network';
import {
  Transactionish,
  TransactionRequest,
  Transaction,
  AATransactionReceipt,
} from '@0xsodium/transactions';
import { JsonRpcProvider, TransactionResponse, BlockTag } from '@ethersproject/providers';
import { BytesLike } from '@ethersproject/bytes';
import { WalletConfig, WalletState } from '@0xsodium/config';
import { Deferrable } from '@0xsodium/utils';
import { IUserOperation } from 'userop';
import { SodiumUserOpBuilder } from './userop';
import { DelegateProof, SodiumNetworkAuthProof } from './utils';

export abstract class Signer extends AbstractSigner {
  abstract getProvider(chainId?: number): Promise<JsonRpcProvider | undefined>
  abstract getWalletContext(chainId?: ChainIdLike): Promise<SodiumContext>
  abstract getWalletConfig(chainId?: ChainIdLike): Promise<WalletConfig[]>
  abstract getWalletState(chainId?: ChainIdLike): Promise<WalletState[]>
  abstract getBalance(chainId?: ChainIdLike, blockTag?: BlockTag): Promise<BigNumber>;
  abstract getNetworks(): Promise<NetworkConfig[]>
  abstract waitForUserOpHash(
    userOpHash: string,
    confirmations?: number,
    timeout?: number,
    chainId?: ChainIdLike | undefined
  ): Promise<AATransactionReceipt>;
  abstract getWalletUpgradeTransactions(chainId?: ChainIdLike): Promise<Transaction[]>;

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
    paymasterId?: string
  ): Promise<TransactionResponse>

  // opInfo.preOpGas, paid, data.validAfter, data.validUntil, targetSuccess, targetResult
  abstract simulateHandleOp(userOp: IUserOperation, target: string, data: string, chainId?: ChainIdLike): Promise<boolean>

  abstract sendUserOperationRaw(
    userOp: IUserOperation,
    chainId?: ChainIdLike,
  ): Promise<TransactionResponse>

  // sendTransactionBatch provides the ability to send an array/batch of transactions as a single native on-chain transaction.
  // This method works identically to sendTransaction but offers a different syntax for convience, readability and type clarity.
  abstract sendTransactionBatch(
    transactions: Deferrable<TransactionRequest[] | Transaction[]>,
    chainId?: ChainIdLike,
    paymasterId?: string
  ): Promise<TransactionResponse>

  abstract newUserOpBuilder(
    chainId?: ChainIdLike,
  ): Promise<SodiumUserOpBuilder>

  // isDeployed ..
  abstract isDeployed(chainId?: ChainIdLike): Promise<boolean>

  abstract genDelegateProof(trustee: string, delegateExpires: number): Promise<{
    proof: DelegateProof,
    sodiumAuthProof?: SodiumNetworkAuthProof
  }>
}

// TODO: move to error.ts, along with others..
export class InvalidSigner extends Error { }

export class NotEnoughSigners extends Error { }
