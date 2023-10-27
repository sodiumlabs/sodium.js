import { JsonRpcProvider as EthJsonRpcProvider } from "@ethersproject/providers";
import { utils } from 'ethers';
import { MulticallWrapper } from 'ethers-multicall-provider';

const ERC4337_BUNDER_METHOD = [
    "eth_sendUserOperation",
    "eth_estimateUserOperationGas",
    "eth_getUserOperationByHash",
    "eth_getUserOperationReceipt",
    "eth_supportedEntryPoints",
    "eth_chainId",
    "debug_bundler_clearState",
    "debug_bundler_dumpMempool",
    "debug_bundler_sendBundleNow",
    "debug_bundler_setBundlingMode",
    "debug_bundler_setReputation",
    "debug_bundler_dumpReputation",
];

const CACHE_METHOD = [
    "eth_maxPriorityFeePerGas",
    "eth_gasPrice",
    "eth_getBlockByNumber",
    "eth_getBalance",
];

export class SodiumJsonRpcProvider extends EthJsonRpcProvider {
    private bundlerRPC: EthJsonRpcProvider;
    private nodeRPC: EthJsonRpcProvider;
    private chainIdPromise: Promise<any> | undefined = undefined;
    private timeoutCacheMap: Map<string, Promise<any>> = new Map<string, Promise<any>>();

    constructor(nodeRPC: string, bundlerRPC: string) {
        super(nodeRPC);
        this.bundlerRPC = new EthJsonRpcProvider(bundlerRPC);
        this.nodeRPC = MulticallWrapper.wrap(new EthJsonRpcProvider(nodeRPC));
    }

    async send(method: string, params: any[]): Promise<any> {
        if (method === "eth_chainId") {
            return this.requestChainId(method, params);
        }
        if (CACHE_METHOD.includes(method)) {
            return this.requestTimeoutCache(method, params);
        }
        if (ERC4337_BUNDER_METHOD.includes(method)) {
            return this.bundlerRPC.send(method, params);
        }
        return this.nodeRPC.send(method, params);
    }

    private async requestChainId(method: string, params: any[]): Promise<any> {
        if (this.chainIdPromise !== undefined) {
            return this.chainIdPromise;
        }
        const rv = this.bundlerRPC.send(method, params);
        this.chainIdPromise = rv;
        return this.chainIdPromise;
    }

    private async requestTimeoutCache(method: string, params: any[]): Promise<any> {
        const key = `${method}-${utils.id(JSON.stringify(params))}`;
        if (this.timeoutCacheMap.has(key)) {
            return this.timeoutCacheMap.get(key);
        }
        const rv = this.nodeRPC.send(method, params);
        this.timeoutCacheMap.set(key, rv);
        setTimeout(() => {
            this.timeoutCacheMap.delete(key);
        }, 1000);
        return this.timeoutCacheMap.get(key);
    }
}