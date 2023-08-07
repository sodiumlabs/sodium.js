import { ethers, TypedDataField, Signer, Bytes, utils } from 'ethers'
import { Deferrable, resolveProperties } from '@ethersproject/properties'
import { SecurityManager } from '@0xsodium/wallet-contracts/gen/typechain/contracts/base/SecurityManager';
import { TypedDataSigner as EthersTypedDataSigner } from '@ethersproject/abstract-signer';

export abstract class TypedDataSigner extends Signer implements EthersTypedDataSigner {
  abstract _signTypedData(domain: ethers.TypedDataDomain, types: Record<string, ethers.TypedDataField[]>, value: Record<string, any>): Promise<string>;
  static isTypedDataSigner(value: any): value is TypedDataSigner {
    return !!(value && value._isSigner && value._signTypedData);
  }
}

export async function resolveArrayProperties<T>(object: Readonly<Deferrable<T>> | Readonly<Deferrable<T>>[]): Promise<T> {
  if (Array.isArray(object)) {
    // T must include array type
    return Promise.all(object.map((o) => resolveProperties(o))) as any
  }

  return resolveProperties(object)
}

export async function findLatestLog(provider: ethers.providers.Provider, filter: ethers.providers.Filter): Promise<ethers.providers.Log | undefined> {
  const toBlock = filter.toBlock === 'latest' ? await provider.getBlockNumber() : filter.toBlock as number
  const fromBlock = filter.fromBlock as number

  try {
    const logs = await provider.getLogs({ ...filter, toBlock: toBlock })
    return logs.length === 0 ? undefined : logs[logs.length - 1]
  } catch (e) {
    // TODO Don't assume all errors are bad
    const pivot = Math.floor(((toBlock - fromBlock) / 2) + fromBlock)
    const nhalf = await findLatestLog(provider, { ...filter, fromBlock: pivot, toBlock: toBlock })
    if (nhalf !== undefined) return nhalf
    return findLatestLog(provider, { ...filter, fromBlock: fromBlock, toBlock: pivot })
  }
}

export type SodiumNetworkAuthProof = {
  addSessionStruct?: SecurityManager.AddSessionStruct
  recoverStruct?: SecurityManager.RecoverStruct
  authProof: string
}

export type DelegateProof = {
  walletAddress: string,
  salt: string,
  trustee: string,
  delegater: string,
  delegateExpires: number,
  proof: string
}

// {0x02}{trustee}{delegater}{delegateExpires}{signature}{delegateproof}
export const signType2 = async (signer: Signer, data: Bytes, delegateproof: DelegateProof): Promise<string> => {
  const signature = await signer.signMessage(data);
  const sig = ethers.utils.defaultAbiCoder.encode([
    "address",
    "address",
    "uint256",
    "bytes",
    "bytes"
  ], [
    delegateproof.trustee,
    delegateproof.delegater,
    delegateproof.delegateExpires,
    signature,
    delegateproof.proof,
  ]);
  return utils.hexlify(utils.concat([
    "0x02",
    sig
  ]));
}

// {0x01}{signer}{signature}
export const signType1 = async (signer: Signer, data: Bytes): Promise<string> => {
  const signature = await signer.signMessage(data);
  const address = await signer.getAddress();
  return utils.hexlify(utils.concat([
    "0x01",
    address,
    signature
  ]));
}

function getDelegateTypedDataTypesAndValue(trustee: string, delegateExpires: number): { types: Record<string, Array<TypedDataField>>, value: Record<string, any> } {
  const types = {
    Delegate: [
      { name: 'trustee', type: 'address' },
      { name: 'delegateExpires', type: 'uint64' },
    ]
  }
  const value = {
    trustee: trustee,
    delegateExpires: delegateExpires,
  }
  return { types, value };
}

export const genDelegateProof = async (
  walletAddress: string,
  accountSalt: string,
  trustee: string,
  delegater: TypedDataSigner,
  delegateExpires: number
): Promise<DelegateProof> => {
  const typeData = getDelegateTypedDataTypesAndValue(trustee, delegateExpires);
  const proof = await delegater._signTypedData({
    verifyingContract: walletAddress
  }, typeData.types, typeData.value);
  return {
    walletAddress,
    salt: accountSalt,
    trustee,
    delegater: await delegater.getAddress(),
    delegateExpires,
    proof
  };
}

export type SignFunc = (message: ethers.utils.Bytes) => Promise<string>;