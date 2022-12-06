// TODO: consider adopting config-loading approach from hardhat to allow code in config file
import ow from 'ow';
import { BundlerConfig as BundlerConfig1 } from '@0xsodium/config';

export type BundlerConfig = BundlerConfig1;

// TODO: implement merging config (args -> config.js -> default) and runtime shape validation
export const BundlerConfigShape = {
  beneficiary: ow.string,
  entryPoint: ow.string,
  gasFactor: ow.string,
  minBalance: ow.string,
  mnemonic: ow.string,
  network: ow.string,
  port: ow.string
}

export const bundlerConfigDefault: Partial<BundlerConfig> = {
  port: '3000'
}