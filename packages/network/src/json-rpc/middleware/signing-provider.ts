import { JsonRpcHandlerFunc, JsonRpcRequest, JsonRpcResponse, JsonRpcResponseCallback, JsonRpcMiddlewareHandler, JsonRpcHandler } from '../types'

export const SignerJsonRpcMethods = [
  'personal_sign', 'eth_sign', 'eth_signTypedData', 'eth_signTypedData_v4',
  'eth_sendTransaction', 'eth_sendRawTransaction',
  
  'sodium_getWalletContext', 'sodium_getWalletConfig', 'sodium_getWalletState', 'sodium_getNetworks',
  'sodium_updateConfig', 'sodium_publishConfig', 'sodium_gasRefundOptions',
  'sodium_getNonce', 'sodium_relay', 'sodium_getPaymasterInfos',

  'eth_decrypt', 'eth_getEncryptionPublicKey',
  'wallet_addEthereumChain', 'wallet_switchEthereumChain',
  'wallet_registerOnboarding', 'wallet_watchAsset',
  'wallet_scanQRCode'
]

export class SigningProvider implements JsonRpcMiddlewareHandler {

  private provider: JsonRpcHandler

  constructor(provider: JsonRpcHandler) {
    this.provider = provider
  }

  sendAsyncMiddleware = (next: JsonRpcHandlerFunc) => {
    return (request: JsonRpcRequest, callback: JsonRpcResponseCallback, chainId?: number) => {
      // Forward signing requests to the signing provider
      if (SignerJsonRpcMethods.includes(request.method)) {
        this.provider.sendAsync(request, callback, chainId)
        return
      }

      // Continue to next handler
      next(request, callback, chainId)
    }
  }

}
