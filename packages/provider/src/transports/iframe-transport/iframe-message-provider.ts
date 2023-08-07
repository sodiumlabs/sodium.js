import { OpenWalletIntent, ProviderMessage, InitState, EventType, WindowSessionParams, OpenState } from '../../types'
import { BaseProviderTransport } from '../base-provider-transport'
import { logger, base64EncodeObject } from '@0xsodium/utils'
import { isBrowserExtension, isUnityPlugin } from '../../utils'

// ..
let registeredWindowMessageProvider: IframeMessageProvider | undefined

type WindowSize = {
  width: number,
  height: number
}
export class IframeMessageProvider extends BaseProviderTransport {
  private walletURL: URL

  private iframe: HTMLIFrameElement | null;
  private getWindowSize: () => WindowSize;

  constructor(walletAppURL: string, getWindowSize: () => WindowSize) {
    super()
    this.walletURL = new URL(walletAppURL);
    this.getWindowSize = getWindowSize;
  }

  register = () => {
    if (registeredWindowMessageProvider) {
      // overriding the registered message provider
      registeredWindowMessageProvider.unregister()
      registeredWindowMessageProvider = this
    }

    // listen for incoming messages from wallet
    window.addEventListener('message', this.onWindowEvent)
    registeredWindowMessageProvider = this

    // open heartbeat
    this.on('open', () => {
      if (this.iframe) {
        this.state = OpenState.OPENED
        this.iframe.addEventListener('close', () => {
          this.close();
        });
      }
    })

    // close clean up
    this.on('close', () => {
      this.closeWallet();
    })

    this._registered = true
  }

  setIframeSizeAndPosition = () => {
    if (!this.iframe) {
      return;
    }
    const windowSize = this.getWindowSize();
    const windowPos = [
      Math.abs(window.innerWidth / 2 - windowSize.width / 2),
      Math.abs(window.innerHeight / 2 - windowSize.height / 2)
    ]
    this.iframe.style.width = `${windowSize.width}px`;
    this.iframe.style.height = `${windowSize.height}px`;
    this.iframe.style.top = `${windowPos[1]}px`;
    this.iframe.style.left = `${windowPos[0]}px`;
  }

  unregister = () => {
    this._registered = false
    this.closeWallet()

    // disable message listener
    if (registeredWindowMessageProvider === this) {
      registeredWindowMessageProvider = undefined
    }
    window.removeEventListener('message', this.onWindowEvent)
    // clear event listeners
    this.events.removeAllListeners()
  }

  openWallet = (path?: string, intent?: OpenWalletIntent, networkId?: string | number): void => {
    const windowSize = this.getWindowSize();
    const sessionId = `${performance.now()}`
    if (this.iframe) {
      // 延迟显示，防止闪烁
      setTimeout(() => {
        if (this.iframe && this.state == OpenState.OPENED) {
          this.iframe.style.display = 'block';
        }
      }, 200);
      this.setIframeSizeAndPosition();
      this.iframe.focus()
      this.state = OpenState.OPENED;
      this.sendMessage({
        idx: -1, type: EventType.OPEN, data: {
          path, intent, networkId, sessionId
        }
      })
      return
    }

    // Instantiate new walletURL for this call
    const walletURL = new URL(this.walletURL.href)
    const windowSessionParams = new WindowSessionParams()

    if (path && path !== '') {
      walletURL.pathname = path.toLowerCase()
    }

    // Set session, intent and network id on walletURL
    this._init = InitState.NIL
    this._sessionId = sessionId
    windowSessionParams.set('sid', this._sessionId)

    if (intent) {
      // for the window-transport, we eagerly/optimistically set the origin host
      // when connecting to the wallet, however, this will be verified and enforced
      // on the wallet-side, so if a dapp provides the wrong origin, it will be dropped.
      if (intent.type === 'connect') {
        if (!intent.options) intent.options = {}

        // skip setting origin host if we're in an browser extension execution context
        // allow origin that is passed in
        if (
          !isBrowserExtension() && !isUnityPlugin()
        ) {
          intent.options.origin = window.location.origin
        }
      }
      // encode intent as base64 url-encoded param
      windowSessionParams.set('intent', base64EncodeObject(intent))
    }
    if (networkId) {
      windowSessionParams.set('net', `${networkId}`)
    }

    windowSessionParams.set('iframe', 'true');

    // serialize params
    walletURL.search = windowSessionParams.toString()

    const iframe = document.createElement('iframe');
    iframe.src = walletURL.href;
    iframe.style.position = 'fixed';
    iframe.style.border = 'none';
    iframe.style.display = 'block';
    iframe.style.zIndex = '10000';
    iframe.title = 'sodium.app';
    iframe.style.borderRadius = '15px';
    this.iframe = iframe;
    this.setIframeSizeAndPosition();
    document.body.appendChild(iframe);
  }

  closeWallet() {
    this.close()
    if (this.iframe) {
      this.iframe.style.display = 'none';
      this.sendMessage({
        idx: -1, type: EventType.CLOSE, data: null
      })
    }
  }

  // onmessage, receives ProviderMessageResponse from the wallet post-message transport
  private onWindowEvent = (event: MessageEvent) => {
    // Security check, ensure message is coming from wallet origin url
    if (event.origin !== this.walletURL.origin) {
      // Safetly can skip events not from the wallet
      return
    }

    let message: ProviderMessage<any>
    try {
      message = JSON.parse(event.data)
    } catch (err) {
      // event is not a ProviderMessage JSON object, skip
      return
    }

    if (!message) {
      throw new Error('ProviderMessage object is empty')
    }

    // handle message with base message provider
    this.handleMessage(message)
  }

  sendMessage(message: ProviderMessage<any>) {
    if (!this.iframe) {
      logger.warn('IframeMessageProvider: sendMessage failed as iframe is unavailable')
      return
    }
    if (!this.iframe.contentWindow) {
      logger.warn('IframeMessageProvider: sendMessage failed as iframe window is unavailable')
      return
    }
    const postedMessage = typeof message !== 'string' ? JSON.stringify(message) : message
    this.iframe.contentWindow.postMessage(postedMessage, this.walletURL.origin)
  }
}
