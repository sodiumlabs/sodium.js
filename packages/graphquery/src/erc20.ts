import { BigNumber } from 'ethers';
import { UserTokenInfo } from './types';
import { IERC20Metadata__factory } from '@0xsodium/wallet-contracts';
import { Provider } from '@ethersproject/abstract-provider';

const providerTokenMetadataCaches: {
  [chainId: number]: {
    [address: string]: {
      name: Promise<string>;
      symbol: Promise<string>;
      decimals: Promise<number>;
    }
  }
} = {};

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
export const getTokenMetadataByAddress = async (address: string, chainId: number, provider: Provider): Promise<{
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
    const contract = IERC20Metadata__factory.connect(address, provider);
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

export const getUserERC20Tokens = async (subgraphHost: string, account: string, chainId: number, first: number = 10, provider: Provider): Promise<UserTokenInfo[]> => {
  const queue = [
    fallbackAribOne,
    fallbackServer
  ];

  for (let i = 0; i < queue.length; i++) {
    try {
      const result = await queue[i](subgraphHost, account, chainId, first, provider);
      return result;
    } catch (e) {
      // console.log("getUserERC20Tokens", e)
      continue;
    }
  }

  throw new Error("getUserERC20Tokens failed")
}

async function fallbackAribOne(
  subgraphHost: string,
  account: string,
  chainId: number,
  first: number = 10,
  provider: Provider
): Promise<UserTokenInfo[]> {
  if (chainId !== 31337) {
    throw new Error(`fallbackLocalHardhat only support chainId 31377 or 42161:${chainId}`);
  }

  const tokens: UserTokenInfo[] = [
    {
      token: {
        chainId: chainId,
        address: "0x1DD6b5F9281c6B4f043c02A83a46c2772024636c",
        symbol: "LUAUSD",
        decimals: 18,
        name: "Lumi Finance USD",
        centerData: {},
      },
      balance: BigNumber.from(0)
    },
    {
      token: {
        chainId: chainId,
        address: "0x15B6eC24f59Fea164C6e235941Aa00fB0d4A32f6",
        symbol: "LUAOP",
        decimals: 18,
        name: "Lumi Finance Option",
        centerData: {},
      },
      balance: BigNumber.from(0)
    },
    {
      token: {
        chainId: chainId,
        address: "0xc3aBC47863524ced8DAf3ef98d74dd881E131C38",
        symbol: "LUA",
        decimals: 18,
        name: "Lumi Finance Token",
        centerData: {},
      },
      balance: BigNumber.from(0)
    },
    {
      token: {
        chainId: chainId,
        address: "0xCb55d61E6299597C39FEeC3D4036E727aFBe11bE",
        symbol: "LUAG",
        decimals: 18,
        name: "Lumi Finance Governance Token",
        centerData: {},
      },
      balance: BigNumber.from(0)
    },
    {
      token: {
        chainId: chainId,
        address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        symbol: "USDT",
        decimals: 6,
        name: "USD Tether",
        centerData: {},
      },
      balance: BigNumber.from(0)
    },
    {
      token: {
        chainId: chainId,
        address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        symbol: "USDC",
        decimals: 6,
        name: "USDCoin",
        centerData: {},
      },
      balance: BigNumber.from(0)
    },
    {
      token: {
        chainId: chainId,
        address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
        symbol: "USDC.e",
        decimals: 6,
        name: "USD Coin (arb1)",
        centerData: {},
      },
      balance: BigNumber.from(0)
    },
    {
      token: {
        chainId: chainId,
        address: "0x7f90122bf0700f9e7e1f688fe926940e8839f353",
        symbol: "2CRV",
        decimals: 18,
        name: "Curve 2CRV",
        centerData: {},
      },
      balance: BigNumber.from(0)
    },
  ];

  const coins = await Promise.all(tokens.map(async t => {
    const contract = IERC20Metadata__factory.connect(t.token.address, provider);
    const balance = await contract.balanceOf(account);
    return {
      ...t,
      balance: balance
    };
  }));

  return coins.filter(c => c.balance.gt(0));
}

async function fallbackServer(
  subgraphHost: string,
  account: string,
  chainId: number,
  first: number = 10,
  provider: Provider
): Promise<UserTokenInfo[]> {
  const res = await fetch(`https://subgraph-fallback.vercel.app/api/balances?chainId=${chainId}&walletAddress=${account}`);
  const result: {
    tokenAddress: string;
    balance: string;
  }[] = await res.json();
  const balances = await Promise.all(result.map(async b => {
    // get token metadata
    const metadata = await getTokenMetadataByAddress(b.tokenAddress, chainId, provider);
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