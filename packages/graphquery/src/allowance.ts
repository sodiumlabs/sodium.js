import { Allowance } from './types';
import { GraphQLClient, gql } from 'graphql-request';

const document = gql`
query QueryUserAllowances($accountId: String, $first: Int, $skip: Int) {
  tokenApprovals(first: $first, skip: $skip, where: { ownerAccount: $accountId, value_gt: 0 }) {
    logIndex
    txnHash
    blockNumber
    blockHash
    blockTimestamp
    value
    spenderAccount {
      id
    }
    token {
      id
      name
      decimals
      symbol
    }
  }
}
`

export const getTokenAllowances = async (
    account: string,
    chainId: number,
    first: number = 100,
    skip: number = 0
): Promise<Allowance[]> => {
    const client = new GraphQLClient("https://api.thegraph.com/subgraphs/name/alberthuang24/sodium80001erc20subgraph")
    const result = await client.request(document, {
        accountId: account.toLowerCase(),
        first,
        skip
    });
    // @ts-ignore
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