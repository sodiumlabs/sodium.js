import { ethers } from 'ethers'
import { TypedDataDomain, TypedDataField }  from '@ethersproject/abstract-signer'

export interface TypedData {
  domain: TypedDataDomain
  types: Record<string, Array<TypedDataField>>
  message: Record<string, any>
  primaryType?: string
}

export type { TypedDataDomain, TypedDataField }

export const encodeTypedDataHash = (typedData: TypedData): string => {
  return ethers.utils._TypedDataEncoder.hash(typedData.domain, typedData.types, typedData.message)
}

export const encodeTypedDataDigest = (typedData: TypedData): Uint8Array => {
  return ethers.utils.arrayify(encodeTypedDataHash(typedData))
}
