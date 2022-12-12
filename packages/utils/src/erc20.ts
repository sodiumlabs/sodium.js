export type ERC20OrNativeTokenMetadata = {
    address: string;
    chainId: number;
    isNativeToken?: true;
    name: string;
    symbol: string;
    decimals: number;
    centerData: {
        logoURI?: string;
        website?: string;
        description?: string;
    },
};