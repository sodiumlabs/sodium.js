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
  entryPointAddress: "0xDCa3e88DE9f6A2d55917d1DFE0C81aEDD363c0f9",
  singletonAddress: "0x5754BDe51007daC3CADD085E6047e38E30249D1B",
  genesisSingletonAddress: "0x09f30e8aC8F1bb14858477b72643eDa238d24339",
  defaultHandlerAddress: "0x8436173e1D2599Ed3d0aF23C5e231cAee39d67c9",
  walletCreatorAddress: "0xCA25952469BBae82c63A7A75D8aBc7dBf9442e18",

  modules: {
    multicall: ""
  },

  utils: {
    gasEstimator: "0x67db13d7f40eFa5FFC6c6ba0217ACe7FD7df444F"
  },

  nonStrict: false
};