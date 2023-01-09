import { Allowance } from './types';
import { getBuiltGraphSDK } from './.graphclient';

export const getTokenAllowances = async (
    account: string,
    chainId: number,
    first: number = 100,
    skip: number = 0
): Promise<Allowance[]> => {
    const sdk = getBuiltGraphSDK();
    const result = await sdk.QueryUserAllowances({
        accountId: account.toLowerCase(),
        first,
        skip
    });
    const allowances: Allowance[] = result.tokenApprovals.map(approval => {
        return {
            transactionHash: approval.txnHash,
            blockNumber: approval.blockNumber,
            blockTimestamp: approval.blockTimestamp,
            to: approval.spenderAccount.id,
            value: approval.value,
            token: {
                chainId: chainId,
                decimals: approval.token.decimals,
                address: approval.token.id,
                symbol: approval.token.symbol,
                name: approval.token.name,

                // TODO 使用nextjs单独配置中心化信息并采集
                centerData: {

                }
            },
        }
    })
    return allowances;
}