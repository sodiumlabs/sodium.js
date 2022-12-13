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
  entryPointAddress: "0xd32cFD0A47069905444a6F49f66da2e9557E361a",
  singletonAddress: "0xA5512e27D4F5178DA33750647944F7496b608F55",
  defaultHandlerAddress: "0xd8CBB2C610f4877547077752c99B7D5ce2E5F115",
  walletCreatorAddress: "0xFc9A2c3eCb53fB7aA1149bB3A0CC82232DC2A8ef",

  modules: {
    multicall: ""
  },

  utils: {
    gasEstimator: "0xdF0e977EC85e0fD97daA4cB39869DCb7FCc26389"
  },

  nonStrict: false
};