// import { getBuiltGraphSDK } from './.graphclient';
import { TransactionHistory } from './types';
import { GraphQLClient, gql } from 'graphql-request';

const allDocument = gql`
query QueryUserHistories($accountId: String, $first: Int, $skip: Int) {
  transfers: tokenTransfers(first: $first, skip: $skip, where: { from: $accountId }, orderBy: blockNumber, orderDirection: desc) {
    logIndex
    txnHash
    blockNumber
    blockTimestamp
    blockHash
    amount
    from {
      id
    }
    to {
      id
    }
    token {
      id
      name
      decimals
      symbol
    }
  }
  receives: tokenTransfers(first: $first, skip: $skip, where: { to: $accountId }, orderBy: blockNumber, orderDirection: desc) {
    blockNumber
    blockHash
    blockTimestamp
    txnHash
    logIndex
    amount
    from {
      id
    }
    to {
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

const tokenDocument = gql`
query QueryUserTokenHistories($accountId: String, $tokenAddress: String, $first: Int, $skip: Int) {
  transfers: tokenTransfers(first: $first, skip: $skip, where: { from: $accountId, token: $tokenAddress }, orderBy: blockNumber, orderDirection: desc) {
    logIndex
    txnHash
    blockNumber
    blockTimestamp
    blockHash
    amount
    from {
      id
    }
    to {
      id
    }
    token {
      id
      name
      decimals
      symbol
    }
  }
  receives: tokenTransfers(first: $first, skip: $skip, where: { to: $accountId, token: $tokenAddress }, orderBy: blockNumber, orderDirection: desc) {
    blockNumber
    blockTimestamp
    blockHash
    txnHash
    logIndex
    amount
    from {
      id
    }
    to {
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

export const getHistories = async (
    account: string,
    chainId: number,
    first: number = 100,
    skip: number = 0,
    tokenAddress?: string
): Promise<TransactionHistory[]> => {
    const client = new GraphQLClient(`https://api.thegraph.com/subgraphs/name/alberthuang24/sodium${chainId}erc20subgraph`)
    let result;
    if (tokenAddress) {
        result = await client.request(tokenDocument, {
            accountId: account.toLowerCase(),
            first: first,
            skip,
            tokenAddress,
        })
    } else {
        result = await client.request(allDocument, {
            accountId: account.toLowerCase(),
            first: first,
            skip,
        })
    }

    const mapx: {
        [key: string]: TransactionHistory
    } = {};

    // @ts-ignore
    result.transfers.forEach(a => {
        if (!mapx[a.blockNumber]) {
            mapx[a.blockNumber] = {
                type: 'complete',
                transactionHash: a.txnHash,
                input: "",
                block: {
                    blockNumber: a.blockNumber,
                    blockTimestamp: a.blockTimestamp,
                },
                userOpHash: "",
                erc20Transfers: [
                    {
                        from: a.from.id,
                        to: a.to.id,
                        token: {
                            chainId: chainId,
                            decimals: a.token.decimals,
                            address: a.token.id,
                            symbol: a.token.symbol,
                            name: a.token.name,

                            // TODO 使用nextjs单独配置中心化信息并采集
                            centerData: {

                            }
                        },
                        amount: a.amount
                    }
                ],
                erc1155Transfers: [],
                erc721Transfers: [],
                prefix: "sent"
            }
        }
    });

    // @ts-ignore
    result.receives.forEach(a => {
        if (!mapx[a.blockNumber]) {
            // type: TransactionType,
            // transactionHash: string,
            // input: string,
            // block: TransactionBlock,
            // userOpHash: string,
            // erc20Transfers: TransactionERC20Transfer[]
            // // coming soon
            // erc1155Transfers: any[]
            // // coming soon
            // erc721Transfers: any[]
            // prefix: TransactionPrefixName
            mapx[a.blockNumber] = {
                type: 'complete',
                transactionHash: a.txnHash,
                input: "",
                block: {
                    blockNumber: a.blockNumber,
                    blockTimestamp: a.blockTimestamp,
                },
                userOpHash: "",
                erc20Transfers: [
                    {
                        from: a.from.id,
                        to: a.to.id,
                        token: {
                            chainId: chainId,
                            decimals: a.token.decimals,
                            address: a.token.id,
                            symbol: a.token.symbol,
                            name: a.token.name,

                            // TODO 使用nextjs单独配置中心化信息并采集
                            centerData: {

                            }
                        },
                        amount: a.amount
                    }
                ],
                erc1155Transfers: [],
                erc721Transfers: [],
                prefix: "received"
            }
        }
    });

    return Object.values(mapx);
}