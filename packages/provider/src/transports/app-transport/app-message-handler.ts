import {
  ProviderMessageRequest,
  ProviderMessage,
  EventType,
  InitState,
} from '../../types'
import { WalletRequestHandler } from '../wallet-request-handler'
import { BaseWalletTransport } from '../base-wallet-transport'
import { logger, sanitizeNumberString, base64DecodeObject } from '@0xsodium/utils'

export class AppMessageHandler extends BaseWalletTransport {
  private _isPopup: boolean = false
  private postMessageToWebView = (message: string): void => {
    throw new Error("required register")
  }

  constructor(walletRequestHandler: WalletRequestHandler) {
    super(walletRequestHandler)
    this._init = InitState.OK
  }

  async register(_postMessageToWebView?: (message: string) => void) {
    if (!_postMessageToWebView) {
      throw new Error("_postMessageToWebView required");
    }
    this.postMessageToWebView = _postMessageToWebView;
    this._registered = true;
  }

  public onWebviewMessage = (event: { data: string, origin: string }) => {
    let request: ProviderMessageRequest
    try {
      request = JSON.parse(event.data)
    } catch (err) {
      // event is not a ProviderMessage JSON object, skip
      return
    }

    logger.debug('RECEIVED MESSAGE', request)

    // Handle message via the base transport
    this.handleMessage(request)
  }

  unregister() {
    this._registered = false
    this.postMessageToWebView = () => {};
  }

  // postMessage sends message to the dapp window
  sendMessage(message: ProviderMessage<any>) {
    // prepare payload
    const payload = JSON.stringify(message)
    // post-message to app.
    // only for init requests, we send to '*' origin
    if (message.type === EventType.INIT) {
      this.postMessage(payload, true)
    } else {
      this.postMessage(payload)
    }
  }

  get isPopup(): boolean {
    return this._isPopup
  }

  private postMessage(message: any, init = false) {
    if (init !== true && this._init !== InitState.OK) {
      logger.error('impossible state, should not be calling postMessage until inited')
      return
    }
  }
}