import { JsonRpcProvider as EthJsonRpcProvider } from "@ethersproject/providers";
import { utils } from "ethers";

export class CacheNetworkProvider extends EthJsonRpcProvider {
    private chainIdPromise: Promise<any> | undefined = undefined;
    private timeoutCacheMap: Map<string, Promise<any>> = new Map<string, Promise<any>>();

    constructor(url: string | utils.ConnectionInfo) {
        super(url);
    }

    async send(method: string, params: any[]): Promise<any> {
        if (method === "eth_chainId") {
            return this.requestChainId(method, params);
        }
        if (["eth_maxPriorityFeePerGas"].includes(method)) {
            return this.requestTimeoutCache(method, params);
        }
        const result = super.send(method, params);
        return result;
    }

    private async requestChainId(method: string, params: any[]): Promise<any> {
        if (this.chainIdPromise !== undefined) {
            return this.chainIdPromise;
        }
        const rv = super.send(method, params);
        this.chainIdPromise = rv;
        return this.chainIdPromise;
    }

    private async requestTimeoutCache(method: string, params: any[]): Promise<any> {
        if (this.timeoutCacheMap.has(method)) {
            return this.chainIdPromise;
        }
        const rv = super.send(method, params);
        this.timeoutCacheMap.set(method, rv);
        setTimeout(() => {
            this.timeoutCacheMap.delete(method);
        }, 500);
        return this.timeoutCacheMap.get(method);
    }
}