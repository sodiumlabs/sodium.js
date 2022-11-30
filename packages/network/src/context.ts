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
  entryPointAddress: "",
  singletonAddress: "",
  defaultHandlerAddress: "",
  walletCreatorAddress: "",

  modules: {

  },

  nonStrict: false
};