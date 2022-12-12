// WalletContext is the module addresses deployed on a network, aka the context / environment
// of the Sequence Smart Wallet system on Ethereum.
export interface WalletContext {
  entryPointAddress: string;
  singletonAddress: string;
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
  entryPointAddress: "0xC8Ddd44bB33BBC2c8DCcB0BB958DdE47363D5C28",
  singletonAddress: "0xA5512e27D4F5178DA33750647944F7496b608F55",
  defaultHandlerAddress: "0xd8CBB2C610f4877547077752c99B7D5ce2E5F115",
  walletCreatorAddress: "0x34D0F455e9fC681ab9896CeeA5f1A5acbFb4497a",

  modules: {
    multicall: ""
  },

  utils: {
    gasEstimator: "0xdF0e977EC85e0fD97daA4cB39869DCb7FCc26389"
  },

  nonStrict: false
};