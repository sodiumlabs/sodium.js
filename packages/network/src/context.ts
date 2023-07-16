export interface SodiumContext {
  factoryAddress: string;
  sodiumAuthAddress: string;
  singletonAddress: string;
  fallbackHandlerAddress: string;
  opValidatorAddress: string;
  entryPointAddress: string;
}

const defaultSodiumContext: SodiumContext = {
  factoryAddress: "0x5Eb4bcAEB78a7a765FA3F7285eE6B3E08CCB2c09",
  sodiumAuthAddress: "0x8987ECEa30337FD2ebC5A07Da0cc6EFFCc051BE6",
  singletonAddress: "0x10672E5954092c08E20917d959A7735781d221C8",
  fallbackHandlerAddress: "0x70FBaDc6939DCCD7b953eD4712c921ac30b8cdCd",
  opValidatorAddress: "0x56e049F8bf238233B1eB93943fbE629B8B99B089",
  entryPointAddress: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
};

export const createContext = (context?: Partial<SodiumContext>): SodiumContext => {
  if (!context) return defaultSodiumContext;
  return {
    ...defaultSodiumContext,
    ...context,
  };
}