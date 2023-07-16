import { BigNumber, BigNumberish, ethers } from "ethers";
import { EntryPoint, EntryPoint__factory } from "@0xsodium/wallet-contracts";
import {
  Utils,
  UserOperationMiddlewareCtx,
  IClient as OriginIClient,
  IUserOperationBuilder,
  ISendUserOperationOpts,
  IUserOperation as OriginIUserOperation,
} from "userop";
import { SodiumJsonRpcProvider } from "./jsonrpc";
import { TransactionReceipt } from '@ethersproject/abstract-provider';
import { hexValue } from "ethers/lib/utils";

export interface IUserOperation extends OriginIUserOperation {

}

export interface ISendUserOperationResponse {
  hash: string;
  userOpHash: string;
  confirmations: number;
  from: string;
  nonce: number;
  gasLimit: BigNumberish;
  value: BigNumberish;
  data: string;
  chainId: BigNumberish;
}

export interface IClient {
  waitUserOp: (userOpHash: string, confirmations?: number | undefined, timeout?: number | undefined) => Promise<TransactionReceipt>;
  sendUserOperation: (builder: IUserOperationBuilder, opts?: ISendUserOperationOpts) => Promise<ISendUserOperationResponse>;
  buildUserOperation: (builder: IUserOperationBuilder) => Promise<IUserOperation>;
  sendUserOperationRaw(
    userOp: IUserOperation,
  ): Promise<ISendUserOperationResponse>
}

export class Client implements IClient {
  private provider: ethers.providers.JsonRpcProvider;

  public entryPoint: EntryPoint;
  public chainId: BigNumberish;
  public waitTimeoutMs: number;
  public waitIntervalMs: number;

  private constructor(
    eip4337RPCURL: string,
    nodeRPCURL: string,
    entryPoint: string
  ) {
    this.provider = new SodiumJsonRpcProvider(nodeRPCURL, eip4337RPCURL);
    this.entryPoint = EntryPoint__factory.connect(entryPoint, this.provider);
    this.chainId = ethers.BigNumber.from(1);
    this.waitTimeoutMs = 60000;
    this.waitIntervalMs = 5000;
  }

  public static async init(
    eip4337RPCURL: string,
    nodeRPCURL: string,
    entryPoint: string
  ) {
    const instance = new Client(eip4337RPCURL, nodeRPCURL, entryPoint);
    instance.chainId = await instance.provider
      .getNetwork()
      .then((network) => ethers.BigNumber.from(network.chainId));

    return instance;
  }

  async buildUserOperation(builder: IUserOperationBuilder) {
    return builder.buildOp(this.entryPoint.address, this.chainId);
  }

  async waitUserOp(userOpHash: string, confirmations?: number | undefined, timeout?: number | undefined): Promise<TransactionReceipt> {
    const end = Date.now() + (timeout ? timeout : this.waitTimeoutMs);
    const block = await this.provider.getBlock("latest");
    console.log("Waiting for user operation", userOpHash);
    while (Date.now() < end) {
      const events = await this.entryPoint.queryFilter(
        this.entryPoint.filters.UserOperationEvent(userOpHash),
        Math.max(0, block.number - 100)
      );
      if (events.length > 0) {
        const ev = events[0];

        console.log(`User operation ${userOpHash} ${ev.args.success ? "succeeded" : "failed"}`)
        if (!ev.args.success) {
          const revertEvents = await this.entryPoint.queryFilter(
            this.entryPoint.filters.UserOperationRevertReason(userOpHash),
            Math.max(0, block.number - 100)
          );
          if (revertEvents.length > 0) {
            throw new Error(
              `User operation ${userOpHash} failed: ${revertEvents[0].args.revertReason}`
            );
          }
          throw new Error(`User operation ${userOpHash} failed`);
        }

        const rp = await events[0].getTransactionReceipt();

        /// 这里可能会有一些不兼容问题
        /// 比如开发者可能会将transactionHash存储到数据库中
        rp.transactionHash = userOpHash;
        return rp;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, this.waitIntervalMs)
      );
    }
    throw new Error(`Timeout waiting for user operation ${userOpHash}`);
  }

  async sendUserOperationRaw(
    userOp: IUserOperation,
  ): Promise<ISendUserOperationResponse> {
    const userOpHash = ((await this.provider.send("eth_sendUserOperation", [
      Utils.OpToJSON(userOp),
      this.entryPoint.address,
    ])) as string);
    return {
      hash: userOpHash,
      userOpHash,
      confirmations: 0,
      from: userOp.sender,
      nonce: BigNumber.from(userOp.nonce).toNumber(),
      gasLimit: BigNumber.from(userOp.callGasLimit),
      value: BigNumber.from(0),
      data: hexValue(userOp.callData),
      chainId: this.chainId,
    }
  }

  async sendUserOperation(
    builder: IUserOperationBuilder,
    opts?: ISendUserOperationOpts
  ): Promise<ISendUserOperationResponse> {
    const dryRun = Boolean(opts?.dryRun);
    const op = await this.buildUserOperation(builder);
    await opts?.onBuild?.(op);

    const userOpHash = dryRun
      ? new UserOperationMiddlewareCtx(
        op,
        this.entryPoint.address,
        this.chainId
      ).getUserOpHash()
      : ((await this.provider.send("eth_sendUserOperation", [
        Utils.OpToJSON(op),
        this.entryPoint.address,
      ])) as string);
    builder.resetOp();

    return {
      hash: userOpHash,
      userOpHash,
      confirmations: 0,
      from: op.sender,
      nonce: BigNumber.from(op.nonce).toNumber(),
      gasLimit: BigNumber.from(op.callGasLimit),
      value: BigNumber.from(0),
      data: hexValue(op.callData),
      chainId: this.chainId,
    }
  }
}
