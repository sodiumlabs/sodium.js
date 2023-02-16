import { BigNumber } from 'ethers';
import { UserTokenInfo } from './types';
import { GraphQLClient, gql } from 'graphql-request';

const document = gql`
query QueryUserERC20($accountId: ID, $first: Int) {
  accounts(first: 1, skip: 0, where: {id: $accountId}) {
    id
    balances(first: $first, skip: 0, where: { value_gt: 0 }) {
      id
      value
      token {
        id
        name
        decimals
        symbol
      }
    }
  }
}`

export const getUserERC20Tokens = async (account: string, chainId: number, first: number = 10): Promise<UserTokenInfo[]> => {
    const client = new GraphQLClient(`https://api.thegraph.com/subgraphs/name/alberthuang24/sodium${chainId}erc20subgraph`)
    const result = await client.request(document, {
        accountId: account.toLowerCase(),
        first,
    });
    if (result.accounts.length == 0) {
        return [];
    }
    // @ts-ignore
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
            balance: BigNumber.from(b.value)
        }
    });
}