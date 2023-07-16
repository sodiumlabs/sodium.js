import { TransactionHistory } from './types';
import { GraphQLClient, gql } from 'graphql-request';
import { Provider } from '@ethersproject/abstract-provider';
import { getTokenMetadataByAddress } from './erc20';

const allDocument = gql`
query QueryUserHistories($accountId: String, $first: Int, $skip: Int) {
  transfers: tokenTransfers(first: $first, skip: $skip, where: { from: $accountId }, orderBy: blockNumber, orderDirection: desc) {
    blockNumber
    blockTimestamp
    blockHash
    txnHash
    logIndex
    amount
    from
    to
    tokenAddress
  }
  receives: tokenTransfers(first: $first, skip: $skip, where: { to: $accountId }, orderBy: blockNumber, orderDirection: desc) {
    blockNumber
    blockTimestamp
    blockHash
    txnHash
    logIndex
    amount
    from
    to
    tokenAddress
  }
}
`

const tokenDocument = gql`
query QueryUserTokenHistories($accountId: String, $tokenAddress: String, $first: Int, $skip: Int) {
  transfers: tokenTransfers(first: $first, skip: $skip, where: { from: $accountId, token: $tokenAddress }, orderBy: blockNumber, orderDirection: desc) {
    blockNumber
    blockTimestamp
    blockHash
    txnHash
    logIndex
    amount
    from
    to
    tokenAddress
  }
  receives: tokenTransfers(first: $first, skip: $skip, where: { to: $accountId, token: $tokenAddress }, orderBy: blockNumber, orderDirection: desc) {
    blockNumber
    blockTimestamp
    blockHash
    txnHash
    logIndex
    amount
    from
    to
    tokenAddress
  }
}
`

type TransferEvent = {
  blockNumber: string
  blockTimestamp: number
  blockHash: string
  txnHash: string
  logIndex: number
  amount: string
  from: string
  to: string
  tokenAddress: string
}

export const getHistories = async (
  subgraphHost: string,
  account: string,
  chainId: number,
  first: number = 100,
  skip: number = 0,
  provider: Provider,
  tokenAddress?: string
): Promise<TransactionHistory[]> => {
  // const client = new GraphQLClient(`${subgraphHost}/subgraphs/name/alberthuang24/sodium${chainId}erc20transfer`)
  let result: {
    transfers: TransferEvent[],
    receives: TransferEvent[]
  };
  // if (tokenAddress) {
  //   result = await client.request(tokenDocument, {
  //     accountId: account.toLowerCase(),
  //     first: first,
  //     skip,
  //     tokenAddress,
  //   })
  // } else {
  //   result = await client.request(allDocument, {
  //     accountId: account.toLowerCase(),
  //     first: first,
  //     skip,
  //   })
  // }

  const mapx: {
    [key: string]: Promise<TransactionHistory>
  } = {};

  const convertTransferEvent2TransactionHistory = async (a: TransferEvent, prefix: string): Promise<TransactionHistory> => {
    const tokenMetadata = await getTokenMetadataByAddress(a.tokenAddress, chainId, provider);
    return {
      type: 'completed',
      transactionHash: a.txnHash,
      input: "",
      block: {
        blockNumber: a.blockNumber,
        blockTimestamp: a.blockTimestamp,
      },
      userOpHash: "",
      erc20Transfers: [
        {
          from: a.from,
          to: a.to,
          amount: a.amount,
          token: {
            chainId: chainId,
            decimals: tokenMetadata.decimals,
            address: a.tokenAddress,
            symbol: tokenMetadata.symbol,
            name: tokenMetadata.name,
            centerData: tokenMetadata.centerData,
          }
        }
      ],
      erc1155Transfers: [],
      erc721Transfers: [],
      prefix,
    }
  }

  // result.transfers.forEach(a => {
  //   if (!mapx[a.blockNumber]) {
  //     mapx[a.blockNumber] = convertTransferEvent2TransactionHistory(a, "sent")
  //   }
  // });

  // result.receives.forEach(a => {
  //   if (!mapx[a.blockNumber]) {
  //     mapx[a.blockNumber] = convertTransferEvent2TransactionHistory(a, "received");
  //   }
  // });

  const histories = await Promise.all(Object.values(mapx));
  // order by block number desc
  return histories.sort((a, b) => {
    return parseInt(b.block.blockNumber) - parseInt(a.block.blockNumber);
  });
}