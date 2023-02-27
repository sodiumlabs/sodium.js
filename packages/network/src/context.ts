// WalletContext is the module addresses deployed on a network, aka the context / environment
// of the Sequence Smart Wallet system on Ethereum.
export interface WalletContext {
  entryPointAddress: string;
  singletonAddress: string;
  genesisSingletonAddress: string;
  defaultHandlerAddress: string;
  walletCreatorAddress: string;

  modules: {
    multicall: string
  };

  utils: {
    gasEstimator: string
  };

  nonStrict?: boolean;
}

export const sodiumContext: WalletContext = {
  entryPointAddress: "0x0aE1B76389397Dc81c16eB8e2dEb0C592D3C873c",
  singletonAddress: "0x09f30e8aC8F1bb14858477b72643eDa238d24339",
  genesisSingletonAddress: "0x09f30e8aC8F1bb14858477b72643eDa238d24339",
  defaultHandlerAddress: "0xb961f9F277386e449f324A9B8A0b3FDE837BbF08",
  walletCreatorAddress: "0xCA25952469BBae82c63A7A75D8aBc7dBf9442e18",

  modules: {
    multicall: ""
  },

  utils: {
    gasEstimator: "0x67db13d7f40eFa5FFC6c6ba0217ACe7FD7df444F"
  },

  nonStrict: false
};