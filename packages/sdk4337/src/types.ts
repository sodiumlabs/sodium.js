import { ERC20OrNativeTokenMetadata } from '@0xsodium/utils';
import { BigNumber } from 'ethers';
export type PaymasterInfo = {
    id: string
    token: ERC20OrNativeTokenMetadata

    // wei
    amount: BigNumber
    expiry: number
}