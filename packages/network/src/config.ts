import { BigNumberish } from 'ethers'
import { JsonRpcProvider } from '@ethersproject/providers'
import { stringTemplate, validateAndSortNetworks } from './utils'

export enum ChainId {
  // Ethereum
  MAINNET = 1,
  ROPSTEN = 3,
  RINKEBY = 4,
  GOERLI = 5,
  KOVAN = 42,

  // Polygon
  POLYGON = 137,
  POLYGON_MUMBAI = 80001,

  // BSC
  BSC = 56,
  BSC_TESTNET = 97,

  // Optimism
  OPTIMISM = 10,
  OPTIMISM_TESTNET = 69,

  // Arbitrum One
  ARBITRUM = 42161,
  ARBITRUM_TESTNET = 421611,

  // Arbitrum Nova
  ARBITRUM_NOVA = 42170,

  // Avalanche
  AVALANCHE = 43114,
  AVALANCHE_TESTNET = 43113,

  // Fantom
  FANTOM = 250,
  FANTOM_TESTNET = 4002,

  // Gnosis Chain (XDAI)
  GNOSIS = 100,

  // AURORA
  AURORA = 1313161554,
  AURORA_TESTNET = 1313161556
}

export interface NetworkConfig {
  title: string
  name: string
  nativeTokenSymbol: string
  chainId: number
  subgraphHost?: string
  testnet?: boolean
  blockExplorer?: BlockExplorerConfig
  rpcUrl?: string
  bundlerUrl?: string
  provider?: JsonRpcProvider
  indexerUrl?: string
  // indexer?: Indexer
  // relayer?: Relayer | RpcRelayerOptions
  // isDefaultChain identifies the default network. For example, a dapp may run on the Polygon
  // network and may configure the wallet to use it as its main/default chain.
  isDefaultChain?: boolean
  // isAuthChain identifies the network containing wallet config contents.
  isAuthChain?: boolean
  // Disabled / deprecated chain
  disabled?: boolean
}

export type BlockExplorerConfig = {
  name?: string
  rootUrl: string
  addressUrl?: string
  txnHashUrl?: string
}

export const indexerURL = (network: string) => stringTemplate('https://${network}-indexer.sodium.app', { network: network })
export const bundlerURL = (network: string) => stringTemplate('https://${network}-bundler.sodium.app', { network: network })
export const nodesURL = (network: string) => stringTemplate('https://nodes.sodium.app/${network}', { network: network })

export const networks: Record<ChainId, NetworkConfig> = {
  [ChainId.MAINNET]: {
    chainId: ChainId.MAINNET,
    name: 'mainnet',
    title: 'Ethereum',
    nativeTokenSymbol: 'ETH',
    blockExplorer: {
      name: 'Etherscan',
      rootUrl: 'https://etherscan.io/'
    }
  },
  [ChainId.ROPSTEN]: {
    chainId: ChainId.ROPSTEN,
    name: 'ropsten',
    title: 'Ropsten',
    nativeTokenSymbol: 'ETH',
    testnet: true,
    blockExplorer: {
      name: 'Etherscan (Ropsten)',
      rootUrl: 'https://ropsten.etherscan.io/'
    }
  },
  [ChainId.RINKEBY]: {
    chainId: ChainId.RINKEBY,
    name: 'rinkeby',
    title: 'Rinkeby',
    nativeTokenSymbol: 'ETH',
    testnet: true,
    blockExplorer: {
      name: 'Etherscan (Rinkeby)',
      rootUrl: 'https://rinkeby.etherscan.io/'
    },
    disabled: true
  },
  [ChainId.GOERLI]: {
    chainId: ChainId.GOERLI,
    name: 'goerli',
    title: 'Goerli',
    nativeTokenSymbol: 'ETH',
    testnet: true,
    blockExplorer: {
      name: 'Etherscan (Goerli)',
      rootUrl: 'https://goerli.etherscan.io/'
    }
  },
  [ChainId.KOVAN]: {
    chainId: ChainId.KOVAN,
    name: 'kovan',
    title: 'Kovan',
    nativeTokenSymbol: 'ETH',
    testnet: true,
    blockExplorer: {
      name: 'Etherscan (Kovan)',
      rootUrl: 'https://kovan.etherscan.io/'
    }
  },
  [ChainId.POLYGON]: {
    chainId: ChainId.POLYGON,
    name: 'polygon',
    title: 'Polygon',
    nativeTokenSymbol: 'MATIC',
    blockExplorer: {
      name: 'Polygonscan',
      rootUrl: 'https://polygonscan.com/'
    }
  },
  [ChainId.POLYGON_MUMBAI]: {
    chainId: ChainId.POLYGON_MUMBAI,
    name: 'mumbai',
    title: 'Polygon Mumbai',
    nativeTokenSymbol: 'MATIC',
    testnet: true,
    blockExplorer: {
      name: 'Polygonscan (Mumbai)',
      rootUrl: 'https://mumbai.polygonscan.com/'
    }
  },
  [ChainId.BSC]: {
    chainId: ChainId.BSC,
    name: 'bsc',
    nativeTokenSymbol: 'BNB',
    title: 'BNB Smart Chain',
    blockExplorer: {
      name: 'BSCScan',
      rootUrl: 'https://bscscan.com/'
    }
  },
  [ChainId.BSC_TESTNET]: {
    chainId: ChainId.BSC_TESTNET,
    name: 'bsc-testnet',
    title: 'BNB Smart Chain Testnet',
    nativeTokenSymbol: 'BNB',
    testnet: true,
    blockExplorer: {
      name: 'BSCScan (Testnet)',
      rootUrl: 'https://testnet.bscscan.com/'
    }
  },
  [ChainId.OPTIMISM]: {
    chainId: ChainId.OPTIMISM,
    name: 'optimism',
    title: 'Optimism',
    nativeTokenSymbol: 'ETH',
    blockExplorer: {
      name: 'Etherscan (Optimism)',
      rootUrl: 'https://optimistic.etherscan.io/'
    }
  },
  [ChainId.OPTIMISM_TESTNET]: {
    chainId: ChainId.OPTIMISM_TESTNET,
    name: 'optimism-testnet',
    title: 'Optimistic Kovan',
    nativeTokenSymbol: 'ETH',
    testnet: true,
    blockExplorer: {
      name: 'Etherscan (Optimism Testnet)',
      rootUrl: 'https://kovan-optimistic.etherscan.io/'
    }
  },
  [ChainId.ARBITRUM]: {
    chainId: ChainId.ARBITRUM,
    name: 'arbitrum',
    title: 'Arbitrum One',
    nativeTokenSymbol: 'ETH',
    blockExplorer: {
      name: 'Arbiscan',
      rootUrl: 'https://arbiscan.io/'
    }
  },
  [ChainId.ARBITRUM_TESTNET]: {
    chainId: ChainId.ARBITRUM_TESTNET,
    name: 'arbitrum-testnet',
    title: 'Arbitrum Testnet',
    nativeTokenSymbol: 'ETH',
    testnet: true,
    blockExplorer: {
      name: 'Arbiscan (Testnet)',
      rootUrl: 'https://testnet.arbiscan.io/'
    }
  },
  [ChainId.ARBITRUM_NOVA]: {
    chainId: ChainId.ARBITRUM_NOVA,
    name: 'arbitrum-nova',
    title: 'Arbitrum Nova',
    nativeTokenSymbol: 'ETH',
    blockExplorer: {
      name: 'Nova Explorer',
      rootUrl: 'https://nova-explorer.arbitrum.io/'
    }
  },
  [ChainId.AVALANCHE]: {
    chainId: ChainId.AVALANCHE,
    name: 'avalanche',
    title: 'Avalanche',
    nativeTokenSymbol: 'AVAX',
    blockExplorer: {
      name: 'Snowtrace',
      rootUrl: 'https://snowtrace.io/'
    }
  },
  [ChainId.AVALANCHE_TESTNET]: {
    chainId: ChainId.AVALANCHE_TESTNET,
    name: 'avalanche-testnet',
    title: 'Avalanche Testnet',
    nativeTokenSymbol: 'AVAX',
    testnet: true,
    blockExplorer: {
      name: 'Snowtrace (Testnet)',
      rootUrl: 'https://testnet.snowtrace.io/'
    }
  },
  [ChainId.FANTOM]: {
    chainId: ChainId.FANTOM,
    name: 'fantom',
    title: 'Fantom',
    nativeTokenSymbol: 'FTM',
    blockExplorer: {
      name: 'FTMScan',
      rootUrl: 'https://ftmscan.com/'
    }
  },
  [ChainId.FANTOM_TESTNET]: {
    chainId: ChainId.FANTOM_TESTNET,
    name: 'fantom-testnet',
    title: 'Fantom Testnet',
    nativeTokenSymbol: 'FTM',
    testnet: true,
    blockExplorer: {
      name: 'FTMScan (Testnet)',
      rootUrl: 'https://testnet.ftmscan.com/'
    }
  },
  [ChainId.GNOSIS]: {
    chainId: ChainId.GNOSIS,
    name: 'gnosis',
    title: 'Gnosis Chain',
    nativeTokenSymbol: 'GNO',
    blockExplorer: {
      name: 'Gnosis Chain Explorer',
      rootUrl: 'https://blockscout.com/xdai/mainnet/'
    }
  },
  [ChainId.AURORA]: {
    chainId: ChainId.AURORA,
    name: 'aurora',
    title: 'Aurora',
    nativeTokenSymbol: 'NEAR',
    blockExplorer: {
      name: 'Aurora Explorer',
      rootUrl: 'https://aurorascan.dev/'
    }
  },
  [ChainId.AURORA_TESTNET]: {
    chainId: ChainId.AURORA_TESTNET,
    name: 'aurora-testnet',
    title: 'Aurora Testnet',
    nativeTokenSymbol: 'NEAR',
    blockExplorer: {
      name: 'Aurora Explorer (Testnet)',
      rootUrl: 'https://testnet.aurorascan.dev/'
    }
  }
}

export type ChainIdLike = NetworkConfig | BigNumberish

export const mainnetNetworks = validateAndSortNetworks([
  {
    ...networks[ChainId.MAINNET],
    rpcUrl: nodesURL('mainnet'),
    bundlerUrl: bundlerURL('mainnet'),
    indexerUrl: indexerURL('mainnet')
  },
  {
    ...networks[ChainId.POLYGON],
    rpcUrl: nodesURL('polygon'),
    bundlerUrl: bundlerURL('polygon'),
    indexerUrl: indexerURL('polygon'),
    isDefaultChain: true,
    isAuthChain: true
  },
  {
    ...networks[ChainId.BSC],
    rpcUrl: nodesURL('bsc'),
    indexerUrl: indexerURL('bsc'),
    bundlerUrl: bundlerURL('bsc'),
  },
  {
    ...networks[ChainId.AVALANCHE],
    rpcUrl: nodesURL('avalanche'),
    indexerUrl: indexerURL('avalanche'),
    bundlerUrl: bundlerURL('avalanche'),
  },
  {
    ...networks[ChainId.ARBITRUM],
    rpcUrl: nodesURL('arbitrum'),
    indexerUrl: indexerURL('arbitrum'),
    bundlerUrl: bundlerURL('arbitrum')
  },
  {
    ...networks[ChainId.ARBITRUM_NOVA],
    rpcUrl: nodesURL('arbitrum-nova'),
    indexerUrl: indexerURL('arbitrum-nova'),
    bundlerUrl: bundlerURL('arbitrum-nova'),
  },
  {
    ...networks[ChainId.OPTIMISM],
    rpcUrl: nodesURL('optimism'),
    indexerUrl: indexerURL('optimism'),
    bundlerUrl: bundlerURL('optimism'),
  }
])

export const testnetNetworks = validateAndSortNetworks([
  {
    ...networks[ChainId.RINKEBY],
    rpcUrl: nodesURL('rinkeby'),
    bundlerUrl: bundlerURL('rinkeby'),
    indexerUrl: indexerURL('rinkeby')
  },
  {
    ...networks[ChainId.GOERLI],
    rpcUrl: nodesURL('goerli'),
    bundlerUrl: bundlerURL('goerli'),
    indexerUrl: indexerURL('goerli')
  },
  {
    ...networks[ChainId.POLYGON_MUMBAI],
    rpcUrl: nodesURL('mumbai'),
    bundlerUrl: bundlerURL('mumbai'),
    indexerUrl: indexerURL('mumbai'),
    isDefaultChain: true,
    isAuthChain: true
  },
  {
    ...networks[ChainId.BSC_TESTNET],
    rpcUrl: nodesURL('bsc-testnet'),
    bundlerUrl: bundlerURL('bsc-testnet'),
    indexerUrl: indexerURL('bsc-testnet')
  }
])
