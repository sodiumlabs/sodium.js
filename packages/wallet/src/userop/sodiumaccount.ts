import {
    UserOperationBuilder,
    UserOperationMiddlewareFn,
    Presets,
    IUserOperation,
    UserOperationMiddlewareCtx,
    Utils
} from 'userop';
import {
    EntryPoint__factory,
    EntryPoint,
    Factory,
    Factory__factory,
    Sodium,
    Sodium__factory
} from '@0xsodium/wallet-contracts';
import { SecurityManager } from '@0xsodium/wallet-contracts/gen/typechain/contracts/base/SecurityManager';
import * as ethers from 'ethers';
import { SodiumJsonRpcProvider } from './jsonrpc';
import { SodiumContext } from '@0xsodium/network';
import { Transactionish, TransactionEncoded, toSodiumTransactions, flattenAuxTransactions, sodiumTxAbiEncode } from '@0xsodium/transactions';
import { WalletConfig } from '@0xsodium/config';
import { keccak256 } from 'ethers/lib/utils';
import { SignFunc } from '../utils';

interface GasEstimate {
    preVerificationGas: ethers.BigNumberish;
    verificationGas: ethers.BigNumberish;
    callGasLimit: ethers.BigNumberish;
}

const estimateCreationGas = async (
    provider: ethers.providers.JsonRpcProvider,
    initCode: ethers.BytesLike
): Promise<ethers.BigNumber> => {
    const initCodeHex = ethers.utils.hexlify(initCode);
    const factory = initCodeHex.substring(0, 42);
    const callData = "0x" + initCodeHex.substring(42);
    return await provider.estimateGas({
        to: factory,
        data: callData,
    });
};

// export const simulateHandleOp = (provider: ethers.providers.JsonRpcProvider): UserOperationMiddlewareFn => async (ctx) => {
//     const entryPoint = EntryPoint__factory.connect(ctx.entryPoint, provider);
//     try {
//         await entryPoint.callStatic.simulateHandleOp(ctx.op, ethers.constants.AddressZero, "0x");
//     } catch (error) {
//         if (error.errorName != "ExecutionResult") {
//             throw error;
//         }
//     }
// };

// const txs = await toSodiumTransactions(flattenAuxTransactions(transactions));
export const estimateUserOperationGas =
    (provider: ethers.providers.JsonRpcProvider): UserOperationMiddlewareFn =>
        async (ctx) => {
            if (ethers.BigNumber.from(ctx.op.nonce).isZero()) {
                ctx.op.verificationGasLimit = ethers.BigNumber.from(
                    ctx.op.verificationGasLimit
                ).add(await estimateCreationGas(provider, ctx.op.initCode));
            }

            const est = (await provider.send("eth_estimateUserOperationGas", [
                Utils.OpToJSON(ctx.op),
                ctx.entryPoint,
            ])) as GasEstimate;

            ctx.op.preVerificationGas = ethers.BigNumber.from(est.preVerificationGas).add(30000);
            ctx.op.verificationGasLimit = ethers.BigNumber.from(est.verificationGas).add(30000);
            ctx.op.callGasLimit = ethers.BigNumber.from(est.callGasLimit).add(500000);
        };

export const SodiumSignatureMiddleware =
    (signFunc: SignFunc): UserOperationMiddlewareFn =>
        async (ctx) => {
            ctx.op.signature = await signFunc(
                ethers.utils.arrayify(ctx.getUserOpHash())
            );
        };

export async function getWalletInitCode(
    sodiumContext: SodiumContext,
    accountSlat: string,
): Promise<string> {
    const {
        sodiumAuthAddress,
        fallbackHandlerAddress,
        opValidatorAddress,
        singletonAddress,
        factoryAddress
    } = sodiumContext;
    const sodiumSetup = Sodium__factory.createInterface().encodeFunctionData("setup", [
        sodiumAuthAddress,
        fallbackHandlerAddress,
        opValidatorAddress,
        accountSlat
    ]);
    const deployCode = Factory__factory.createInterface().encodeFunctionData("deployProxy", [
        singletonAddress,
        sodiumSetup,
        accountSlat,
    ]);
    return `${factoryAddress}${deployCode.slice(2)}`;
}

export const SodiumCallData = (
    instance: SodiumUserOpBuilder,
    sessionSigner: ethers.Signer,
): UserOperationMiddlewareFn => {
    const singerAddressPromise = sessionSigner.getAddress();
    const sodiumInterface = Sodium__factory.createInterface();
    return async (ctx) => {
        // 如果未部署, 则使用proof签名
        // 如果已部署, 但是当前signer不是sessionSigner, 则使用proof签名
        // 如果已部署, 且当前signer是sessionSigner, 则使用session签名
        const txns = instance.getTxns();
        const sessionProof = instance.getSessionAuthProof();
        const singerAddress = await singerAddressPromise;

        if (ctx.op.initCode == "0x") {
            const sodium = Sodium__factory.connect(ctx.op.sender, instance.getProvider());
            const result = await sodium.isSessionOwner(singerAddress);
            if (result.existing) {
                ctx.op.callData = sodiumInterface.encodeFunctionData("execute", [
                    txns,
                ])
                return;
            }
        }
        ctx.op.callData = sodiumInterface.encodeFunctionData("executeWithSodiumAuthSession", [
            sessionProof.struct,
            `0x${sessionProof.proof}`,
            txns,
        ])
    };
}

export const EOACallData = (
    instance: SodiumUserOpBuilder,
    sessionSigner: ethers.Signer,
): UserOperationMiddlewareFn => {
    const sodiumInterface = Sodium__factory.createInterface();
    return async (ctx) => {
        const txns = instance.getTxns();
        const op = ctx.op;

        op.callData = sodiumInterface.encodeFunctionData("execute", [
            txns,
        ]);
    };
}

function eqf(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

type SodiumAddSession = {
    struct: SecurityManager.AddSessionStruct

    // sodium network auth proof signature
    // hex string
    proof: string
}

export class SodiumUserOpBuilder extends UserOperationBuilder {
    private signer: ethers.Signer;
    private provider: ethers.providers.JsonRpcProvider;
    private entryPoint: EntryPoint;
    private chainId: number;

    private initCode: string;

    private proxyImpl: Sodium;

    private txns: TransactionEncoded[] = [];

    private paymasterId: string = "0x";

    private factory: Factory;

    /// sodium network auth proof
    private sodiumAddSession: SodiumAddSession;

    private _signFunc: SignFunc;

    private constructor(
        signer: ethers.Signer,
        erc4337BunderRPC: string,
        nodeRPC: string,
        entryPoint: string,
        factory: string,
    ) {
        super();
        this.signer = signer;
        this.provider = new SodiumJsonRpcProvider(nodeRPC, erc4337BunderRPC);
        this.entryPoint = EntryPoint__factory.connect(entryPoint, this.provider);
        this.factory = Factory__factory.connect(
            factory,
            this.provider
        );
        this.initCode = "0x";
        this.proxyImpl = Sodium__factory.connect(
            ethers.constants.AddressZero,
            this.provider
        );
    }

    public setSignFunc(signFunc: SignFunc) {
        this._signFunc = signFunc;
    }

    public resolveAccount: UserOperationMiddlewareFn = async (ctx) => {
        ctx.op.nonce = await this.entryPoint.getNonce(ctx.op.sender, 0);
        ctx.op.initCode = ctx.op.nonce.eq(0) ? this.initCode : "0x";
    };

    public getProvider(): ethers.providers.JsonRpcProvider {
        return this.provider;
    }

    public getTxns(): TransactionEncoded[] {
        return this.txns;
    }

    public getAddress(): string {
        return this.proxyImpl.address;
    }

    public getSessionAuthProof() {
        return this.sodiumAddSession;
    }

    public resetOp(): this {
        this.txns = [];
        this.paymasterId = "0x";
        return super.resetOp();
    }

    public paymasterMiddleware(): UserOperationMiddlewareFn {
        return async (ctx) => {
            ctx.op.paymasterAndData = this.paymasterId;
        };
    }

    public static async initWithEOA(
        sodiumContext: SodiumContext,
        sodiumConfig: WalletConfig,
        signer: ethers.Signer,
        ERC4337BundlerRpc: string,
        ERC4337NodeRpc: string,
        isDeployed: boolean,
        isDelegate: boolean = false,
    ): Promise<SodiumUserOpBuilder> {
        const singerAddress = await signer.getAddress();

        if (!eqf(keccak256(singerAddress), sodiumConfig.accountSlat) && isDelegate == false) {
            throw new Error(`signer address ${singerAddress} not match account slat ${sodiumConfig.accountSlat}`);
        }

        const instance = new SodiumUserOpBuilder(
            signer,
            ERC4337BundlerRpc,
            ERC4337NodeRpc,
            sodiumContext.entryPointAddress,
            sodiumContext.factoryAddress,
        );

        const provider = instance.getProvider();

        const chainId = await provider.getNetwork().then((n) => n.chainId);
        instance.chainId = chainId;

        if (isDeployed) {
            instance.proxyImpl = Sodium__factory.connect(sodiumConfig.address, provider);
            const salt = await instance.proxyImpl.salt();
            if (!eqf(salt, sodiumConfig.accountSlat)) {
                throw new Error(`salt ${salt} not match account slat ${sodiumConfig.accountSlat}`);
            }
        } else {
            try {
                instance.initCode = await getWalletInitCode(sodiumContext, sodiumConfig.accountSlat);
                await instance.entryPoint.callStatic.getSenderAddress(instance.initCode);
                throw new Error("getSenderAddress: unexpected result");
            } catch (error: any) {
                const addr = error?.errorArgs?.sender;
                if (!addr) throw error;

                if (!eqf(addr, sodiumConfig.address)) {
                    throw new Error(`unexpected sender address: ${addr} != ${sodiumConfig.address} chainId: ${chainId}`);
                }

                instance.proxyImpl = Sodium__factory.connect(addr, provider);
            }
        }

        return instance
            .useDefaults({
                sender: instance.proxyImpl.address,
                verificationGasLimit: 200000,
                preVerificationGas: 21000
            })
            .useMiddleware(instance.resolveAccount)
            .useMiddleware(Presets.Middleware.getGasPrice(provider))
            .useMiddleware(EOACallData(instance, signer))
            .useMiddleware(instance.paymasterMiddleware())
            .useMiddleware(estimateUserOperationGas(instance.provider))
        // .useMiddleware(simulateHandleOp(provider))
        // return base.useMiddleware(Presets.Middleware.EOASignature(instance.signer));
    }

    public static async initWithSession(
        sodiumContext: SodiumContext,
        sodiumConfig: WalletConfig,
        signer: ethers.Signer,
        addSessionStruct: SecurityManager.AddSessionStruct,
        authProof: string,
        ERC4337BundlerRpc: string,
        ERC4337NodeRpc: string,
        isDeployed: boolean,
        isDelegate: boolean = false,
    ): Promise<SodiumUserOpBuilder> {
        const sessionKey = await addSessionStruct.sessionKey;
        const singerAddress = await signer.getAddress();
        if (!eqf(sessionKey, singerAddress) && isDelegate == false) {
            throw new Error("session key and signer address are the same");
        }

        const instance = new SodiumUserOpBuilder(
            signer,
            ERC4337BundlerRpc,
            ERC4337NodeRpc,
            sodiumContext.entryPointAddress,
            sodiumContext.factoryAddress,
        );

        instance.sodiumAddSession = {
            struct: addSessionStruct,
            proof: authProof
        }

        const provider = instance.getProvider();

        const chainId = await provider.getNetwork().then((n) => n.chainId);

        instance.chainId = chainId;

        if (isDeployed) {
            instance.proxyImpl = Sodium__factory.connect(sodiumConfig.address, provider);
            const salt = await instance.proxyImpl.salt();
            if (!eqf(salt, sodiumConfig.accountSlat)) {
                throw new Error(`salt ${salt} not match account slat ${sodiumConfig.accountSlat}`);
            }
        } else {
            try {
                instance.initCode = await getWalletInitCode(sodiumContext, sodiumConfig.accountSlat);
                await instance.entryPoint.callStatic.getSenderAddress(instance.initCode);
                throw new Error("getSenderAddress: unexpected result");
            } catch (error: any) {
                const addr = error?.errorArgs?.sender;
                if (!addr) throw error;

                if (!eqf(addr, sodiumConfig.address)) {
                    throw new Error(`unexpected sender address: ${addr} != ${sodiumConfig.address} chainId: ${chainId}`);
                }

                instance.proxyImpl = Sodium__factory.connect(addr, provider);
            }
        }

        return instance
            .useDefaults({
                sender: instance.proxyImpl.address,
                verificationGasLimit: 200000,
                preVerificationGas: 21000
            })
            .useMiddleware(instance.resolveAccount)
            .useMiddleware(Presets.Middleware.getGasPrice(provider))
            .useMiddleware(SodiumCallData(instance, signer))
            .useMiddleware(instance.paymasterMiddleware())
            .useMiddleware(estimateUserOperationGas(instance.provider))
        // .useMiddleware(simulateHandleOp(provider))
        // return base.useMiddleware(Presets.Middleware.EOASignature(instance.signer));
    }

    public async executeTransactionsWithPaymasterId(transactions: Transactionish, paymasterId?: string): Promise<void> {
        const txs = await toSodiumTransactions(flattenAuxTransactions(transactions));
        this.txns = sodiumTxAbiEncode(txs);
        if (paymasterId) {
            this.paymasterId = paymasterId;
        }
    }

    public async executeTransactions(transactions: Transactionish): Promise<void> {
        const txs = await toSodiumTransactions(flattenAuxTransactions(transactions));
        this.txns = sodiumTxAbiEncode(txs);
    }

    public async signUserOp(userOp: IUserOperation): Promise<IUserOperation> {
        const signMiddleware = SodiumSignatureMiddleware(this._signFunc);
        const ctx = new UserOperationMiddlewareCtx(
            userOp,
            this.entryPoint.address,
            this.chainId,
        );
        await signMiddleware(ctx);
        return ctx.op;
    }
}