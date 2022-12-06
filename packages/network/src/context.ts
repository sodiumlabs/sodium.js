// WalletContext is the module addresses deployed on a network, aka the context / environment
// of the Sequence Smart Wallet system on Ethereum.
export interface WalletContext {
  entryPointAddress: string;
  singletonAddress: string;
  defaultHandlerAddress: string;
  walletCreatorAddress: string;

  modules: {

  };

  nonStrict?: boolean;
}

export const sodiumContext = {
  entryPointAddress: "0xC8Ddd44bB33BBC2c8DCcB0BB958DdE47363D5C28",
  singletonAddress: "0xCaDae6742D024f45662c9ca7e15B4c58Cf3a00c7",
  defaultHandlerAddress: "0xd8CBB2C610f4877547077752c99B7D5ce2E5F115",
  walletCreatorAddress: "0x34D0F455e9fC681ab9896CeeA5f1A5acbFb4497a",

  modules: {

  },

  nonStrict: false
};