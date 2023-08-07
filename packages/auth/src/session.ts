// import { SequenceAPIClient } from '@0xsodium/api'
import {
  WalletConfig,
  decodeSignature,
  isDecodedSigner
} from '@0xsodium/config'
import { ETHAuth, Proof } from '@0xsequence/ethauth'
// import { Indexer, SequenceIndexerClient } from '@0xsodium/indexer'
// import { SequenceMetadataClient } from '@0xsodium/metadata'
import { ChainIdLike, NetworkConfig, SodiumContext, findNetworkConfig, getAuthNetwork } from '@0xsodium/network'
import { jwtDecodeClaims } from '@0xsodium/utils'
import { Account } from '@0xsodium/wallet'
import { ethers, Signer as AbstractSigner } from 'ethers'

export type SessionMeta = {
  // name of the app requesting the session, used with ETHAuth
  name: string

  // expiration in seconds for a session before it expires, used with ETHAuth
  expiration?: number
}

export type SessionJWT = {
  token: string
  expiration: number
}

type SessionJWTPromise = {
  token: Promise<string>
  expiration: number
}

type ProofStringPromise = {
  proofString: Promise<string>
  expiration: number
}

export interface SessionDump {
  config: WalletConfig
  context: SodiumContext
  jwt?: SessionJWT
  metadata: SessionMeta
}

// Default session expiration of ETHAuth token (1 week)
export const DEFAULT_SESSION_EXPIRATION = 60 * 60 * 24 * 7

// Long session expiration of ETHAuth token (~1 year)
export const LONG_SESSION_EXPIRATION = 3e7

const EXPIRATION_JWT_MARGIN = 60 // seconds

function getAuthProvider(networks: NetworkConfig[]): ethers.providers.JsonRpcProvider {
  const authChain = getAuthNetwork(networks)
  if (!authChain) throw Error('Auth chain not found')
  return authChain.provider ?? new ethers.providers.JsonRpcProvider(authChain.rpcUrl)
}

function getJWTExpiration(jwt: string): number {
  return jwtDecodeClaims<{ exp: number }>(jwt).exp
}
