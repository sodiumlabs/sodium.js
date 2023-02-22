import { OpenWalletIntent, OpenState, ProviderMessage, InitState, EventType, WindowSessionParams } from '../../types'
import { BaseProviderTransport } from '../base-provider-transport'
import { logger, base64EncodeObject } from '@0xsodium/utils'
import { isBrowserExtension, isUnityPlugin } from '../../utils'

// ..
let registeredWindowMessageProvider: AppMessageProvider | undefined

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (content: string) => void
    }
  }
}

// app

export class AppMessageProvider extends BaseProviderTransport {
  constructor() {
    super()

    // disable init handshake for proxy-transport, we set it to OK, to
    // consider it in completed state.
    this._init = InitState.OK
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

    })

    // close clean up
    this.on('close', () => {
    })

    this._registered = true
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
    if (this.state === OpenState.CLOSED) {
      this.state = OpenState.OPENING
      const sessionId = `${performance.now()}`
      this._sessionId = sessionId
      this.sendMessage({
        idx: -1, type: EventType.OPEN, data: {
          path, intent, networkId, sessionId
        }
      })
    }
  }

  closeWallet() {
    this.sendMessage({
      idx: -1, type: EventType.CLOSE, data: null
    })
    this.close()
  }

  // onmessage, receives ProviderMessageResponse from the wallet post-message transport
  private onWindowEvent = (event: MessageEvent) => {
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

    if (message.origin !== location.href) {
      return
    }

    // handle message with base message provider
    this.handleMessage(message)
  }

  sendMessage(message: ProviderMessage<any>) {
    if (window.ReactNativeWebView === undefined) {
      logger.warn('AppMessageProvider: sendMessage failed as iframe is unavailable')
      return
    }
    const postedMessage = typeof message !== 'string' ? JSON.stringify(message) : message
    window.ReactNativeWebView.postMessage(postedMessage);
  }
}
