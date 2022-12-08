import { ethers, Signer } from 'ethers';
import { WalletContext } from '@0xsodium/network';
import { WalletContractBytecode } from './bytecode';
import { cacheConfig } from './cache';
import { Sodium__factory } from '@0xsodium/wallet-contracts';

export type Platform = 'web' | 'mobile' | 'pc';

// WalletConfig is the configuration of key signers that can access
// and control the wallet
export interface WalletConfig {
  address?: string
  sodiumUserId: string
  platform: Platform
  chainId?: number
}

export interface WalletState {
  context: WalletContext
  config?: WalletConfig

  // the wallet address
  address: string

  // the chainId of the network
  chainId: number

  // whether the wallet has been ever deployed
  deployed: boolean

  // the imageHash of the `config` WalletConfig
  imageHash: string
}

export const createWalletConfig = async (
  sodiumUserId: string,
  platform: Platform
): Promise<WalletConfig> => {
  const config: WalletConfig = {
    sodiumUserId,
    platform
  }
  return config;
}

export const getWalletInitCode = async (localSigner: Signer, config: WalletConfig, context: WalletContext) => {
  const singletonInterface = Sodium__factory.createInterface();
  const sodiumSetup = singletonInterface.encodeFunctionData("setup", [
    await localSigner.getAddress(),
    ethers.utils.hexDataSlice(ethers.utils.id(config.platform), 0, 4),
    context.defaultHandlerAddress,
    context.entryPointAddress,
  ]);
  const salt = imageHash(config);
  return `${context.singletonAddress}${salt.slice(2)}${sodiumSetup.slice(2)}`;
}

export const addressOf = (config: WalletConfig, context: WalletContext, ignoreAddress: boolean = false): string => {
  if (config.address && !ignoreAddress) {
    return config.address;
  }
  const salt = imageHash(config);
  const codeHash = ethers.utils.keccak256(WalletContractBytecode);
  const hash = ethers.utils.keccak256(
    ethers.utils.solidityPack(['bytes1', 'address', 'bytes32', 'bytes32'], ['0xff', context.walletCreatorAddress, salt, codeHash])
  );
  return ethers.utils.getAddress(ethers.utils.hexDataSlice(hash, 12))
}

export const imageHash = (config: WalletConfig): string => {
  config = sortConfig(config);
  const imageHash = ethers.utils.id(config.sodiumUserId);
  cacheConfig(imageHash, config);
  return imageHash
}

// sortConfig normalizes the list of signer addreses in a WalletConfig
export const sortConfig = (config: WalletConfig): WalletConfig => {
  return config;
}

export const isConfigEqual = (a: WalletConfig, b: WalletConfig): boolean => {
  return imageHash(a) === imageHash(b);
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