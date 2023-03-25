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
  entryPointAddress: "0x4A34499C75F5313265aDaf740B03222D66C264BB",
  singletonAddress: "0xb252e7e84EC2EaA97BEe684B7a58BBC37c44F5c4",
  genesisSingletonAddress: "0xb252e7e84EC2EaA97BEe684B7a58BBC37c44F5c4",
  defaultHandlerAddress: "0xef38f0b0AE4FD66D1BA869697f93A8A05e1708d1",
  walletCreatorAddress: "0xCA25952469BBae82c63A7A75D8aBc7dBf9442e18",

  modules: {
    multicall: ""
  },

  utils: {
    gasEstimator: "0x4A34499C75F5313265aDaf740B03222D66C264BB"
  },

  nonStrict: false
};