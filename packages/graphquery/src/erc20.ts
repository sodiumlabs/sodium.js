import { BigNumber } from 'ethers';
import { UserTokenInfo, TokenList } from './types';
import { GraphQLClient, gql } from 'graphql-request';
import { ERC20Token__factory } from '@0xsodium/wallet-contracts';
import { Signer } from '@ethersproject/abstract-signer';

let providerTokenMetadataCaches: {
  [chainId: number]: {
    [address: string]: {
      name: Promise<string>;
      symbol: Promise<string>;
      decimals: Promise<number>;
    }
  }
} = {}

const document = gql`
query QueryUserERC20Balances($accountId: ID, $first: Int) {
  balances(first: $first, skip: 0, where: { value_gt: 0, account: $accountId }) {
      value
      tokenAddress
  }
}`

const tokenMetadataByAddressCache: {
  [cacheId: string]: {
    name: string;
    symbol: string;
    decimals: number;
    centerData: {
      logoURI?: string;
      website?: string;
      description?: string;
    }
  }
} = {};
export const getTokenMetadataByAddress = async (address: string, chainId: number, signer: Signer): Promise<{
  name: string;
  symbol: string;
  decimals: number;
  centerData: {
    logoURI?: string;
    website?: string;
    description?: string;
  }
}> => {
  address = address.toLowerCase();
  const tryServer = async () => {
    // https://subgraph-fallback.vercel.app/api/tokenmeta?chainId=137&tokenAddress=0xc2132D05D31c914a87C6611C10748AEb04B58e8F
    const res = await fetch(`https://subgraph-fallback.vercel.app/api/tokenmeta?chainId=${chainId}&tokenAddress=${address}`);
    const result: {
      name: string;
      symbol: string;
      decimals: number;
      centerData: {
        logoURI?: string;
        website?: string;
        description?: string;
      }
    } = await res.json();
    return result;
  }

  const buildCacheId = () => {
    return `${chainId}-${address}`
  }
  const tryCache = async () => {
    const cacheId = buildCacheId();
    if (tokenMetadataByAddressCache[cacheId]) {
      return tokenMetadataByAddressCache[cacheId];
    }
    throw new Error("cache miss");
  }

  const tryProvider = async () => {
    if (!providerTokenMetadataCaches[chainId]) {
      providerTokenMetadataCaches[chainId] = {}
    }
    if (providerTokenMetadataCaches[chainId][address]) {
      const metaPromises = providerTokenMetadataCaches[chainId][address];
      const [name, symbol, decimals] = await Promise.all([
        metaPromises.name,
        metaPromises.symbol,
        metaPromises.decimals,
      ]);
      return {
        name,
        symbol,
        decimals,
        centerData: {}
      }
    }
    const contract = ERC20Token__factory.connect(address, signer);
    const metaPromises = {
      name: contract.name(),
      symbol: contract.symbol(),
      decimals: contract.decimals(),
    }
    providerTokenMetadataCaches[chainId][address] = metaPromises;
    const [name, symbol, decimals] = await Promise.all([
      metaPromises.name,
      metaPromises.symbol,
      metaPromises.decimals,
    ]);
    return {
      name,
      symbol,
      decimals,
      centerData: {

      }
    }
  }

  // 优先使用tokenlist
  const tryQueue = [tryCache, tryProvider, tryServer];
  for (let i = 0; i < tryQueue.length; i++) {
    try {
      const result = await tryQueue[i]();
      const cacheId = buildCacheId();
      tokenMetadataByAddressCache[cacheId] = result;
      return result;
    } catch (e) {
      console.log("getTokenMetadataByAddress", e)
    }
  }

  throw new Error("getTokenMetadataByAddress failed")
}

// export const 
// https://subgraph-fallback.vercel.app/api/balances?chainId=137&walletAddress=0xaF8033d40346A9315a385D53FaAeA2891a6443f0

export const getUserERC20Tokens = (subgraphHost: string, account: string, chainId: number, first: number = 10, signer: Signer): Promise<UserTokenInfo[]> => {
  const queue = [
    fallbackThegraph,
    fallbackServer
  ];

  for (let i = 0; i < queue.length; i++) {
    try {
      return queue[i](subgraphHost, account, chainId, first, signer);
    } catch (e) {
      console.log("getUserERC20Tokens", e)
    }
  }

  throw new Error("getUserERC20Tokens failed")
}

async function fallbackThegraph(
  subgraphHost: string,
  account: string,
  chainId: number,
  first: number = 10,
  signer: Signer,
): Promise<UserTokenInfo[]> {
  const client = new GraphQLClient(`${subgraphHost}/subgraphs/name/alberthuang24/sodium${chainId}erc20balance`)
  const result = await client.request<{
    balances: {
      tokenAddress: string,
      value: string,
    }[]
  }>(document, {
    accountId: account.toLowerCase(),
    first,
  });
  if (result.balances.length == 0) {
    return [];
  }
  const balances = await Promise.all(result.balances.map(async b => {
    // get token metadata
    const metadata = await getTokenMetadataByAddress(b.tokenAddress, chainId, signer);
    return {
      token: {
        chainId: chainId,
        address: b.tokenAddress,
        symbol: metadata.symbol,
        decimals: metadata.decimals,
        name: metadata.name,
        centerData: metadata.centerData,
      },
      balance: BigNumber.from(b.value)
    }
  }));
  return balances;
}

async function fallbackServer(
  subgraphHost: string,
  account: string,
  chainId: number,
  first: number = 10,
  signer: Signer
): Promise<UserTokenInfo[]> {
  const res = await fetch(`https://subgraph-fallback.vercel.app/api/balances?chainId=${chainId}&walletAddress=${account}`);
  const result: {
    tokenAddress: string;
    balance: string;
  }[] = await res.json();
  const balances = await Promise.all(result.map(async b => {
    // get token metadata
    const metadata = await getTokenMetadataByAddress(b.tokenAddress, chainId, signer);
    return {
      token: {
        chainId: chainId,
        address: b.tokenAddress,
        symbol: metadata.symbol,
        decimals: metadata.decimals,
        name: metadata.name,
        centerData: metadata.centerData,
      },
      balance: BigNumber.from(b.balance)
    }
  }));
  return balances;
}