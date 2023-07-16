import { JsonRpcProvider as EthJsonRpcProvider } from "@ethersproject/providers";

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

export class SodiumJsonRpcProvider extends EthJsonRpcProvider {
    private bundlerRPC: EthJsonRpcProvider;
    private nodeRPC: EthJsonRpcProvider;
    private chainIdPromise: Promise<any> | undefined = undefined;

    constructor(nodeRPC: string, bundlerRPC: string) {
        super(nodeRPC);
        this.bundlerRPC = new EthJsonRpcProvider(bundlerRPC);
        this.nodeRPC = new EthJsonRpcProvider(nodeRPC);
    }

    async send(method: string, params: any[]): Promise<any> {
        if (ERC4337_BUNDER_METHOD.includes(method)) {
            const rv = this.bundlerRPC.send(method, params);
            if (method === "eth_chainId") {
                if (this.chainIdPromise === undefined) {
                    this.chainIdPromise = rv;
                }
                return rv;
            }
            return rv;
        }
        return this.nodeRPC.send(method, params);
    }
}