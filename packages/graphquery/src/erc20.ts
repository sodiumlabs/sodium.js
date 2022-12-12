import { getBuiltGraphSDK } from './.graphclient';
import { UserTokenInfo } from './types';

export const getUserERC20Tokens = async (account: string, chainId: number, first: number = 10): Promise<UserTokenInfo[]> => {
    const sdk = getBuiltGraphSDK();
    const result = await sdk.QueryUserERC20({
        accountId: account.toLowerCase(),
        first: first
    });
    if (result.accounts.length == 0) {
        return [];
    }
    return result.accounts[0].balances.map(b => {
        return {
            token: {
                chainId: chainId,
                decimals: b.token.decimals,
                address: b.token.id,
                symbol: b.token.symbol,
                name: b.token.name,

                // TODO 使用nextjs单独配置中心化信息并采集
                centerData: {

                }
            },
            balance: b.value
        }
    });
}