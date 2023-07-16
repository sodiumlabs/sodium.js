import { ethers, Signer } from 'ethers';
import { SodiumContext } from '@0xsodium/network';
import { WalletContractBytecode } from './bytecode';
import { cacheConfig } from './cache';
import { Sodium__factory } from '@0xsodium/wallet-contracts';

export type Platform = 'web' | 'mobile' | 'pc';

// WalletConfig is the configuration of key signers that can access
// and control the wallet
export interface WalletConfig {
  address: string
  accountSlat: string
  isSafe: boolean
  chainId?: number
}

export interface WalletState {
  context: SodiumContext
  config?: WalletConfig

  // the wallet address
  address: string

  // the chainId of the network
  chainId: number

  // entrypoint
  entrypoint: string

  // singlotion
  singlotion: string

  handler: string

  // whether the wallet has been ever deployed
  deployed: boolean
}

export const createWalletConfig = async (
  address: string,
  accountSlat: string,
  isSafe: boolean
): Promise<WalletConfig> => {
  const config: WalletConfig = {
    address,
    accountSlat,
    isSafe
  }
  return config;
}

export const accountSlat = (config: WalletConfig): string => {
  config = sortConfig(config);
  const imageHash = config.accountSlat;
  cacheConfig(imageHash, config);
  return imageHash
}

export const calcAccountAddress = (accountSlat: string, factory: string): string => {
  const salt = ethers.utils.arrayify(accountSlat);
  const codeHash = ethers.utils.keccak256(WalletContractBytecode);
  return ethers.utils.getCreate2Address(factory, salt, codeHash);
}

// sortConfig normalizes the list of signer addreses in a WalletConfig
export const sortConfig = (config: WalletConfig): WalletConfig => {
  return config;
}

export const isConfigEqual = (a: WalletConfig, b: WalletConfig): boolean => {
  return accountSlat(a) === accountSlat(b);
}

export const compareAddr = (a: string, b: string): number => {
  const bigA = ethers.BigNumber.from(a)
  const bigB = ethers.BigNumber.from(b)
  if (bigA.lt(bigB)) {
    return -1
  } else if (bigA.eq(bigB)) {
    return 0
  } else {
    return 1
  }
}