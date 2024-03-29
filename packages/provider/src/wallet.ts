import {
  NetworkConfig,
  SodiumContext,
  ChainIdLike,
  JsonRpcSender,
  JsonRpcRouter,
  JsonRpcMiddleware,
  allowProviderMiddleware,
  CachedProvider,
  loggingProviderMiddleware,
  SigningProvider,
  EagerProvider,
  exceptionProviderMiddleware,
  networkProviderMiddleware,
  JsonRpcRequest,
  findNetworkConfig,
  updateNetworkConfig,
  ensureValidNetworks
} from '@0xsodium/network'
import { WalletConfig, WalletState } from '@0xsodium/config'
import { logger } from '@0xsodium/utils'
import { JsonRpcProvider } from '@ethersproject/providers'
import { Web3Provider, Web3Signer } from './provider'
import {
  MuxMessageProvider,
  IframeMessageProvider,
  WindowMessageProvider,
  ProxyMessageProvider,
  ProxyMessageChannelPort,
  UnrealMessageProvider
} from './transports'
import { WalletSession, ProviderEventTypes, ConnectOptions, OpenWalletIntent, ConnectDetails } from './types'
import { ethers } from 'ethers'
import { ExtensionMessageProvider } from './transports/extension-transport/extension-message-provider'
import { LocalStore, ItemStore, LocalStorage } from './utils'
import { WalletUtils } from './utils/index'
import { AppMessageProvider } from './transports/app-transport'

const SESSION_LS_KEY = '@sodium.session'

export interface WalletProvider {
  connect(options?: ConnectOptions): Promise<ConnectDetails>
  disconnect(): void

  isConnected(): boolean
  getSession(): WalletSession | undefined

  getAddress(): Promise<string>
  getNetworks(chainId?: ChainIdLike): Promise<NetworkConfig[]>
  getChainId(): Promise<number>
  getAuthChainId(): Promise<number>

  isOpened(): boolean
  openWallet(path?: string, intent?: OpenWalletIntent, networkId?: string | number): Promise<boolean>
  closeWallet(): void

  getProvider(chainId?: ChainIdLike): Web3Provider | undefined
  getSigner(chainId?: ChainIdLike): Web3Signer

  getWalletContext(): Promise<SodiumContext>
  getWalletConfig(chainId?: ChainIdLike): Promise<WalletConfig[]>
  getWalletState(chainId?: ChainIdLike): Promise<WalletState[]>
  isDeployed(chainId?: ChainIdLike): Promise<boolean>

  getProviderConfig(): ProviderConfig

  on<K extends keyof ProviderEventTypes>(event: K, fn: ProviderEventTypes[K]): void
  once<K extends keyof ProviderEventTypes>(event: K, fn: ProviderEventTypes[K]): void

  utils: WalletUtils
}

export class Wallet implements WalletProvider {
  public utils: WalletUtils

  private config: ProviderConfig
  private session?: WalletSession

  private connectedSites: LocalStore<string[]>

  private transport: {
    // top-level provider which connects all transport layers
    provider?: Web3Provider

    // middleware stack for provider
    router?: JsonRpcRouter
    networkProvider?: JsonRpcMiddleware
    allowProvider?: JsonRpcMiddleware
    cachedProvider?: CachedProvider

    // message communication
    messageProvider?: MuxMessageProvider
    windowMessageProvider?: WindowMessageProvider
    iframeMessageProvider?: IframeMessageProvider
    appMessageProvider?: AppMessageProvider
    proxyMessageProvider?: ProxyMessageProvider
    extensionMessageProvider?: ExtensionMessageProvider
    unrealMessageProvider?: UnrealMessageProvider
  }

  private networks: NetworkConfig[]
  private providers: { [chainId: number]: Web3Provider }

  constructor(network?: string | number, config?: Partial<ProviderConfig>) {
    // config is a Partial, so that we may intersect it with the DefaultProviderConfig,
    // which allows easy overriding and control of the config.
    this.config = { ...DefaultProviderConfig }
    if (config) {
      this.config = { ...this.config, ...config } 
    }
    if (network) {
      this.config.defaultNetworkId = network
    } else if (!this.config.defaultNetworkId) {
      this.config.defaultNetworkId = 'mainnet'
    }

    if (config?.localStorage) {
      LocalStorage.use(config.localStorage)
    }

    if (config?.networks) {
      // this.networks = config.networks
    }

    this.transport = {}
    this.networks = []
    this.providers = {}
    this.connectedSites = new LocalStore('@sodium.connectedSites', [])
    this.utils = new WalletUtils(this)
    this.init()
  }

  private init = () => {
    if (this.transport.provider) {
      // init must have already been called
      return
    }

    // Setup provider

    this.transport.messageProvider = new MuxMessageProvider()

    // multiple message provider setup, first one to connect will be the main transport
    if (this.config.transports?.windowTransport?.enabled) {
      this.transport.windowMessageProvider = new WindowMessageProvider(this.config.walletAppURL)
      this.transport.messageProvider.add(this.transport.windowMessageProvider)
    }
    if (this.config.transports?.iframeTransport?.enabled) {
      this.transport.iframeMessageProvider = new IframeMessageProvider(
        this.config.walletAppURL,
        this.config.transports.iframeTransport.getWindowSize ?? function () {
          return { width: 450, height: 750 };
        }
      )
      this.transport.messageProvider.add(this.transport.iframeMessageProvider)
    }
    if (this.config.transports?.appTransport?.enabled) {
      this.transport.appMessageProvider = new AppMessageProvider();
      this.transport.messageProvider.add(this.transport.appMessageProvider);
    }
    if (this.config.transports?.proxyTransport?.enabled) {
      this.transport.proxyMessageProvider = new ProxyMessageProvider(this.config.transports.proxyTransport.appPort!)
      this.transport.messageProvider.add(this.transport.proxyMessageProvider)
    }
    this.transport.messageProvider.register()

    // .....
    this.transport.allowProvider = allowProviderMiddleware((request: JsonRpcRequest): boolean => {
      if (request.method === 'sodium_setDefaultNetwork') return true
      const isConnected = this.isConnected()
      if (!isConnected) {
        throw new Error('Sodium: wallet not connected')
      }
      return isConnected
    })

    // ...
    this.transport.networkProvider = networkProviderMiddleware((request: JsonRpcRequest): number => {
      // return stub chainId of 0 when not connected to any
      if (!this.networks || this.networks.length === 0) return 0

      // return the default chainId as we're connected
      return this.networks.find(network => network.isDefaultChain)!.chainId
    })

    // Provider proxy to support middleware stack of logging, caching and read-only rpc calls
    this.transport.cachedProvider = new CachedProvider()
    this.transport.cachedProvider.onUpdate(() => {
      if (!this.session) this.session = { providerCache: {} }
      this.session.providerCache = this.transport.cachedProvider!.getCache()
      this.saveSession(this.session)
    })

    // ..
    this.transport.router = new JsonRpcRouter(
      [
        loggingProviderMiddleware,
        this.transport.networkProvider,
        this.transport.allowProvider,
        exceptionProviderMiddleware,
        this.transport.cachedProvider
      ],
      this.transport.messageProvider
    )

    this.transport.provider = new Web3Provider(this.transport.router)

    // NOTE: we don't listen on 'connect' even here as we handle it within connect() method
    // in more synchronous flow.

    // below will update the wallet session object and persist it. In case the session
    // is undefined, we consider the session to have been removed by the user, so we clear it.
    this.transport.messageProvider.on('open', (openInfo: { session?: WalletSession }) => {
      const { session } = openInfo
      if (!session) {
        if (this.session && this.session.accountAddress) {
          // emit disconnect even if previously we had a session, and now we don't.
          this.transport.messageProvider!.emit('disconnect')
        }
        this.clearSession()
      } else {
        this.useSession(session, true)
      }
    })

    // below will update the account upon wallet connect/disconnect - aka, login/logout.
    // if an origin is provided, this operation should be performed only on that origin
    // and shouldn't affect the session of the wallet.
    this.transport.messageProvider.on('accountsChanged', (accounts: string[], origin?: string) => {
      if (origin) {
        if (accounts.length > 0) {
          this.useSession({ accountAddress: accounts[0] }, true)
        }
        return
      }

      if (!accounts || accounts.length === 0 || accounts[0] === '') {
        this.clearSession()
      } else {
        this.useSession({ accountAddress: accounts[0] }, true)
      }
    })

    // below will update the networks automatically when the wallet networks change
    this.transport.messageProvider.on('networks', (networks: NetworkConfig[]) => {
      this.useSession({ networks: networks }, true)
    })

    // below will update the wallet context automatically
    this.transport.messageProvider.on('walletContext', (walletContext: SodiumContext) => {
      this.useSession({ walletContext: walletContext }, true)
    })
  }

  loadSession = async (): Promise<WalletSession | undefined> => {
    const data = await LocalStorage.getInstance().getItem(SESSION_LS_KEY)

    if (!data || data === '') {
      return undefined
    }
    try {
      const session = JSON.parse(data) as WalletSession
      if (session) {
        this.useSession(session, false)
      }
      return session
    } catch (err) {
      logger.warn('loadSession failed, unable to parse session payload from storage.')
      return undefined
    }
  }

  connect = async (options?: ConnectOptions): Promise<ConnectDetails> => {
    if (options?.refresh === true) {
      this.disconnect()
    }

    if (
      this.isConnected() &&
      (await this.isSiteConnected(options?.origin)) &&
      !!this.session &&
      !options?.authorize &&
      !options?.askForEmail
    ) {
      return {
        connected: true,
        session: this.session,
        chainId: ethers.utils.hexlify(await this.getChainId())
      }
    }

    if (options) {
      if (options.authorize && (!options.app || options.app === '')) {
        throw new Error(`connecting with 'authorize' option also requires 'app' to be set`)
      }
    }

    await this.openWallet(undefined, { type: 'connect', options })
    const connectDetails = await this.transport.messageProvider!.waitUntilConnected().catch(e => {
      return { connected: false, error: e.message } as ConnectDetails
    })

    if (connectDetails.connected) {
      if (!!connectDetails.session) {
        this.useSession(connectDetails.session, true)

        this.addConnectedSite(options?.origin)
      } else {
        throw new Error('impossible state, connect response is missing session')
      }
    }

    return connectDetails
  }

  async addConnectedSite(origin: string | undefined) {
    origin = origin || window.location.origin

    const connectedSites = await this.connectedSites.get()

    if (connectedSites) {
      if (connectedSites.includes(origin)) {
        return
      }
      this.connectedSites.set([...connectedSites, origin])
    } else {
      this.connectedSites.set([origin])
    }
  }

  async removeConnectedSite(origin: string) {
    const authorized = await this.connectedSites.get()

    if (authorized) {
      this.connectedSites.set(authorized.filter(domain => domain !== origin))
    }
  }

  getConnectedSites() {
    return this.connectedSites.get()
  }

  async isSiteConnected(origin: string | undefined): Promise<boolean> {
    const authorized = await this.connectedSites.get()

    return !!authorized && authorized.includes(origin || window.location.origin)
  }

  authorize = async (options?: ConnectOptions): Promise<ConnectDetails> => {
    return this.connect({ ...options, authorize: true })
  }

  disconnect(): void {
    if (this.isOpened()) {
      this.closeWallet()
    }
    this.clearSession()
  }

  // TODO: add switchNetwork(network: string | number) which will call wallet_switchEthereumChain
  // and on successful response, will update the provider info here, etc.

  getProviderConfig(): ProviderConfig {
    return this.config
  }

  isOpened(): boolean {
    return this.transport.messageProvider!.isOpened()
  }

  isConnected(): boolean {
    return (
      this.session !== undefined &&
      this.session.networks !== undefined &&
      this.session.networks.length > 0 &&
      this.networks !== undefined &&
      this.networks.length > 0 &&
      !!this.session.accountAddress &&
      this.session.accountAddress.startsWith('0x')
    )
  }

  getSession = (): WalletSession | undefined => {
    if (!this.isConnected()) {
      return undefined
    }
    return this.session
  }

  getAddress = async (): Promise<string> => {
    if (!this.isConnected()) {
      throw new Error('connect first')
    }
    const session = this.getSession()
    return session!.accountAddress!
  }

  getNetworks = async (chainId?: ChainIdLike): Promise<NetworkConfig[]> => {
    if (!this.isConnected() || !this.networks) {
      throw new Error('connect first')
    }
    if (chainId) {
      // filter list to just the specific chain requested
      const network = findNetworkConfig(this.networks, chainId)
      return network ? [network] : []
    }
    return this.networks
  }

  // getChainId returns the default chain id
  getChainId = async (): Promise<number> => {
    if (!this.networks || this.networks.length < 1) {
      throw new Error('networks have not been set by session. connect first.')
    }

    const network = this.networks.find(network => network.isDefaultChain)

    if (!network) {
      throw new Error('networks must have a default chain specified')
    }

    return network.chainId
  }

  getAuthChainId = async (): Promise<number> => {
    if (!this.networks || this.networks.length < 1) {
      throw new Error('networks have not been set by session. connect first.')
    }

    const network = this.networks.find(network => network.isAuthChain)

    if (!network) {
      throw new Error('networks must have an auth chain specified')
    }

    return network.chainId
  }

  openWallet = async (path?: string, intent?: OpenWalletIntent, networkId?: string | number): Promise<boolean> => {
    if (intent?.type !== 'connect' && !this.isConnected()) {
      throw new Error('connect first')
    }

    let currentNetworkId

    if (!this.networks || this.networks.length < 1) {
      currentNetworkId = this.config.defaultNetworkId
    } else {
      currentNetworkId = await this.getChainId()
    }

    this.transport.messageProvider!.openWallet(path, intent, networkId || currentNetworkId)
    await this.transport.messageProvider!.waitUntilOpened()

    return true
  }

  closeWallet = (): void => {
    this.transport.messageProvider!.closeWallet()
  }

  getProvider(chainId?: ChainIdLike): Web3Provider {
    // return the top-level provider message transport when chainId is unspecified
    // and user has not logged in
    if (!this.isConnected()) {
      if (chainId) {
        throw new Error(`session is empty. connect and try again.`)
      } else if (this.transport.provider) {
        return this.transport.provider
      } else {
        throw new Error(`session is empty. connect and try again.`)
      }
    }

    let network: NetworkConfig | undefined = this.networks.find(network => network.isDefaultChain)!
    if (chainId) {
      network = findNetworkConfig(this.networks, chainId)
      if (!network) {
        throw new Error(`network ${chainId} is not in the network list`)
      }
    }

    // return memoized network provider
    if (this.providers[network.chainId]) {
      return this.providers[network.chainId]
    }

    // builder web3 provider stack
    let provider: Web3Provider

    // network.provider may be set by the ProviderConfig override
    const rpcProvider = network.provider ? network.provider : new JsonRpcProvider(network.rpcUrl, network.chainId)

    if (network.isDefaultChain) {
      // communicating with defaultChain will prioritize the wallet message transport
      const router = new JsonRpcRouter(
        [
          loggingProviderMiddleware,
          exceptionProviderMiddleware,
          new EagerProvider({ accountAddress: this.session!.accountAddress, walletContext: this.session!.walletContext }),
          new SigningProvider(this.transport!.provider!),
          this.transport.cachedProvider!
        ],
        new JsonRpcSender(rpcProvider)
      )

      provider = new Web3Provider(router, network.chainId)
    } else {
      // communicating with another chain will bind to that network, but will forward
      // any signing-related requests to the wallet message transport
      const router = new JsonRpcRouter(
        [
          loggingProviderMiddleware,
          exceptionProviderMiddleware,
          new EagerProvider({
            accountAddress: this.session!.accountAddress,
            walletContext: this.session!.walletContext,
            chainId: network.chainId
          }),
          new SigningProvider(this.transport.provider!),
          new CachedProvider(network.chainId)
        ],
        new JsonRpcSender(rpcProvider)
      )

      provider = new Web3Provider(router, network.chainId)
    }

    this.providers[network.chainId] = provider
    return provider
  }

  async getAuthProvider(): Promise<Web3Provider> {
    return this.getProvider((await this.getAuthNetwork()).chainId)!
  }

  async getAuthNetwork(): Promise<NetworkConfig> {
    return (await this.getNetworks()).find(n => n.isAuthChain)!
  }

  getAllProviders(): { [chainId: number]: Web3Provider } {
    return this.providers
  }

  getSigner(chainId?: ChainIdLike): Web3Signer {
    return this.getProvider(chainId)!.getSigner()
  }

  async getAuthSigner(): Promise<Web3Signer> {
    return (await this.getAuthProvider()).getSigner()
  }

  getWalletConfig(chainId?: ChainIdLike): Promise<WalletConfig[]> {
    return this.getSigner().getWalletConfig(chainId)
  }

  getWalletState(chainId?: ChainIdLike): Promise<WalletState[]> {
    return this.getSigner().getWalletState(chainId)
  }

  getWalletContext(): Promise<SodiumContext> {
    return this.getSigner().getWalletContext()
  }

  isDeployed(chainId?: ChainIdLike): Promise<boolean> {
    return this.getSigner(chainId).isDeployed()
  }

  on<K extends keyof ProviderEventTypes>(event: K, fn: ProviderEventTypes[K]) {
    this.transport.messageProvider!.on(event, fn)
  }

  once<K extends keyof ProviderEventTypes>(event: K, fn: ProviderEventTypes[K]) {
    this.transport.messageProvider!.once(event, fn)
  }

  private saveSession = async (session: WalletSession) => {
    const data = JSON.stringify(session)
    await LocalStorage.getInstance().setItem(SESSION_LS_KEY, data)
  }

  private useSession = async (session: WalletSession, autoSave: boolean = true) => {
    if (!this.session) this.session = {}

    // setup wallet context
    if (this.config.sodiumContext) {
      this.session.walletContext = this.config.sodiumContext
    } else if (session.walletContext) {
      this.session.walletContext = session.walletContext
    }

    // setup account
    if (session.accountAddress) {
      this.useAccountAddress(session.accountAddress)
    }

    // setup networks
    if (session.networks) {
      this.useNetworks(session.networks)
    }

    // setup provider cache
    if (session.providerCache) {
      this.transport.cachedProvider!.setCache(session.providerCache)
    }

    // persist
    if (autoSave) {
      this.saveSession(this.session)
    }
  }

  private useAccountAddress(accountAddress: string) {
    if (!this.session) this.session = {}
    this.session.accountAddress = ethers.utils.getAddress(accountAddress)
  }

  private useNetworks(networks: NetworkConfig[]) {
    // set networks in the session
    if (!this.session) this.session = {}

    // set networks on session object
    this.session.networks = networks

    // short-circuit if setting empty network list (aka logged out state)
    if (!this.session.networks || this.session.networks.length === 0) {
      return
    }

    // check if any custom network settings, otherwise return early
    if (!this.config.networks && !this.config.networkRpcUrl) {
      this.networks = networks
      return
    }

    // init networks
    this.networks = networks

    // combine custom network config with networks in the session
    if (this.config.networks) {
      this.networks = networks.map(n => ({ ...n })) // copy
      this.config.networks.forEach(n => {
        const network = findNetworkConfig(this.networks, n.chainId || n.name!)
        if (!network) return
        updateNetworkConfig(n, network)
      })
      ensureValidNetworks(this.networks, true)
    }

    // an extra override for convenience
    if (this.config.networkRpcUrl) {
      const network = this.networks.find(network => network.isDefaultChain)
      if (network) {
        network.rpcUrl = this.config.networkRpcUrl
      }
    }
  }

  private clearSession(): void {
    logger.debug('wallet provider: clearing session')
    LocalStorage.getInstance().removeItem('@sodium.session')
    this.session = undefined
    this.networks = []
    this.providers = {}
    this.transport.cachedProvider?.clearCache()
  }
}

export interface ProviderConfig {
  // The local storage dependency for the wallet provider, defaults to window.localStorage.
  // For example, this option should be used when using React Native since window.localStorage is not available.
  localStorage?: ItemStore

  // Sodium Wallet App URL, default: https://sodium.app
  walletAppURL: string

  // networks is a configuration list of networks used by the wallet. This list
  // is combined with the network list supplied from the wallet upon login,
  // and settings here take precedence such as overriding a relayer setting, or rpcUrl.
  networks?: Partial<NetworkConfig>[]

  // networkRpcUrl will set the provider rpcUrl of the default network
  networkRpcUrl?: string

  // defaultNetworkId is the primary network of a dapp and the default network a
  // provider will communicate. Note: this setting is also configurable from the
  // Wallet constructor's first argument.
  defaultNetworkId?: string | number

  // transports for dapp to wallet jron-rpc communication
  transports?: {
    // WindowMessage transport (optional)
    windowTransport?: {
      enabled: boolean
    }

    iframeTransport?: {
      enabled: boolean
      getWindowSize?: () => {
        width: number
        height: number
      }
    }

    // ProxyMessage transport (optional)
    proxyTransport?: {
      enabled: boolean
      appPort?: ProxyMessageChannelPort
    }

    appTransport?: {
      enabled: boolean
    }

    // // Unreal Engine transport (optional)
    // unrealTransport?: {
    //   enabled: boolean
    // }
  }

  // Sequence Wallet Modules Context override. By default (and recommended), the
  // WalletContext used the one returned by the wallet app upon login.
  //
  // NOTE: do not use this option unless you know what you're doing
  sodiumContext?: SodiumContext
}

export const DefaultProviderConfig: ProviderConfig = {
  walletAppURL: 'https://wallet.sodiums.org/',
  transports: {
    windowTransport: { enabled: false },
    iframeTransport: { enabled: true },
    proxyTransport: { enabled: false },
    appTransport: { enabled: false },
  }
}

let walletInstance: Wallet | undefined

export const initWallet = async (network?: string | number, config?: Partial<ProviderConfig>) => {
  if (walletInstance && walletInstance.isOpened()) {
    walletInstance.closeWallet()
  }
  walletInstance = new Wallet(network, config)
  await walletInstance.loadSession()
  return walletInstance
}

export const getWallet = () => {
  if (!walletInstance) {
    throw new Error('Wallet has not been initialized, call sequence.initWallet(network, config) first.')
  }
  return walletInstance
}
