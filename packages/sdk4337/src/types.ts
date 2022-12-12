import { ERC20OrNativeTokenMetadata } from '@0xsodium/utils';
import { BigNumber } from 'ethers';
export type PaymasterInfo = {
    token: ERC20OrNativeTokenMetadata

    // wei
    amount: BigNumber
    expiry: number
}