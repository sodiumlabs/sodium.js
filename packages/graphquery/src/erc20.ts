import { BigNumber } from 'ethers';
import { UserTokenInfo, TokenList } from './types';
import { GraphQLClient, gql } from 'graphql-request';
import { ERC20Token__factory } from '@0xsodium/wallet-contracts';
import { Signer } from '@ethersproject/abstract-signer';

let tokenListPromises: { [chainId: number]: Promise<TokenList> } = {}
let providerTokenMetadataCaches: {
  [chainId: number]: {
    [address: string]: {
      name: Promise<string>;
      symbol: Promise<string>;
      decimals: Promise<number>;
    }
  }
} = {}

const getTokenListURL = (chainId: number): string => {
  // 80001 https://api-polygon-tokens.polygon.technology/tokenlists/testnet.tokenlist.json
  // 137 https://api-polygon-tokens.polygon.technology/tokenlists/polygonTokens.tokenlist.json
  if (chainId == 80001) {
    return "https://api-polygon-tokens.polygon.technology/tokenlists/testnet.tokenlist.json"
  } else if (chainId == 137) {
    return "https://api-polygon-tokens.polygon.technology/tokenlists/polygonTokens.tokenlist.json"
  }
  throw new Error("Unsupported chainId")
}
export const getTokenList = async (chainId: number): Promise<TokenList> => {
  if (!tokenListPromises[chainId]) {
    const tokenListURL = getTokenListURL(chainId);
    tokenListPromises[chainId] = fetch(tokenListURL).then(res => res.json())
  }
  return tokenListPromises[chainId]
}

const document = gql`
query QueryUserERC20Balances($accountId: ID, $first: Int) {
  balances(first: $first, skip: 0, where: { value_gt: 0, account: $accountId }) {
      value
      tokenAddress
  }
}`

export const getTokenMetadataByAddress = async (address: string, chainId: number, signer: Signer): Promise<{
  meta: {
    name: string;
    symbol: string;
    decimals: number;
  },
  centerData: {
    logoURI?: string;
    website?: string;
    description?: string;
  }
}> => {
  address = address.toLowerCase();
  const tryTokenList = async () => {
    const tokenList = await getTokenList(chainId);
    const token = tokenList.tokens.find(t => t.address.toLowerCase() == address);
    if (!token) {
      throw new Error("Token not found")
    }
    return {
      meta: {
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
      },
      centerData: {
        logoURI: token.logoURI,
      }
    }
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
        meta: {
          name,
          symbol,
          decimals,
        },
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
      meta: {
        name,
        symbol,
        decimals,
      },
      centerData: {

      }
    }
  }

  // 优先使用tokenlist
  const tryQueue = [tryTokenList, tryProvider];
  for (let i = 0; i < tryQueue.length; i++) {
    try {
      return await tryQueue[i]();
    } catch (e) {
      console.log("getTokenMetadataByAddress", e)
    }
  }

  throw new Error("getTokenMetadataByAddress failed")
}

export const getUserERC20Tokens = async (account: string, chainId: number, first: number = 10, signer: Signer): Promise<UserTokenInfo[]> => {
  const client = new GraphQLClient(`https://api.thegraph.com/subgraphs/name/alberthuang24/sodium${chainId}erc20balance`)
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
        symbol: metadata.meta.symbol,
        decimals: metadata.meta.decimals,
        name: metadata.meta.name,
        centerData: metadata.centerData,
      },
      balance: BigNumber.from(b.value)
    }
  }));
  return balances;
}