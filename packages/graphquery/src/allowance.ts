import { Allowance } from './types';
import { GraphQLClient, gql } from 'graphql-request';
import { Signer } from '@ethersproject/abstract-signer';
import { getTokenMetadataByAddress } from './erc20';

const document = gql`
query QueryUserAllowances($accountId: String, $first: Int, $skip: Int) {
  tokenApprovals(first: $first, skip: $skip, where: { ownerAccount: $accountId, value_gt: 0 }) {
    logIndex
    txnHash
    blockNumber
    blockHash
    blockTimestamp
    value
    spenderAccount
    tokenAddress
  }
}
`

export const getTokenAllowances = async (
  account: string,
  chainId: number,
  first: number = 100,
  skip: number = 0,
  signer: Signer
): Promise<Allowance[]> => {
  const client = new GraphQLClient(`https://api.thegraph.com/subgraphs/name/alberthuang24/sodium${chainId}erc20approve`)
  const result = await client.request<{
    tokenApprovals: {
      logIndex: number
      txnHash: string
      blockNumber: string
      blockHash: string
      blockTimestamp: number
      value: string
      spenderAccount: string
      tokenAddress: string
    }[]
  }>(document, {
    accountId: account.toLowerCase(),
    first,
    skip
  });
  const allowances: Allowance[] = await Promise.all(result.tokenApprovals.map<Promise<Allowance>>(async approval => {
    const tokenMeta = await getTokenMetadataByAddress(approval.tokenAddress, chainId, signer);
    return {
      transactionHash: approval.txnHash,
      blockNumber: approval.blockNumber,
      blockTimestamp: approval.blockTimestamp,
      to: approval.spenderAccount,
      value: approval.value,
      token: {
        chainId: chainId,
        decimals: tokenMeta.decimals,
        address: approval.tokenAddress,
        symbol: tokenMeta.symbol,
        name: tokenMeta.name,
        centerData: tokenMeta.centerData,
      },
    }
  }))
  return allowances;
}