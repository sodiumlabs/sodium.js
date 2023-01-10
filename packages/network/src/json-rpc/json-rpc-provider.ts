import { JsonRpcProvider as EthJsonRpcProvider } from "@ethersproject/providers";
import { JsonRpcHandler, JsonRpcRequest, JsonRpcResponseCallback, JsonRpcHandlerFunc } from "./types";
import { createJsonRpcMiddlewareStack } from './router';
import { CachedProvider } from "./middleware";

export class JsonRpcProvider extends EthJsonRpcProvider implements JsonRpcHandler {
    private handler: JsonRpcHandlerFunc

    constructor(...args: any) {
        super(...args);
        this.handler = createJsonRpcMiddlewareStack([
            new CachedProvider()
        ], this.sendAsync.bind(this));
    }

    sendAsync(request: JsonRpcRequest, callback: JsonRpcResponseCallback, chainId?: number) {
        super.send(request.method, request.params || [])
            .then(result => callback(undefined, {
                id: request.id || this._nextId,
                jsonrpc: request.jsonrpc || "2.0",
                result: result,
            }))
            .catch((error) => {
                callback(error)
            });
    }

    send(method: string, params: any[]): Promise<any> {
        return new Promise((resolve, reject) => {
            this.handler({
                jsonrpc: "2.0",
                id: this._nextId++,
                method: method,
                params: params
            }, (error, res) => {
                if (error) {
                    return reject(error);
                }
                return resolve(res!.result);
            });
        })
    }
}