import { BigNumber, BigNumberish } from 'ethers'
import {
  Sodium,
  Sodium__factory
} from '@0xsodium/wallet-contracts';
import { arrayify, resolveProperties } from 'ethers/lib/utils'
import { Signer } from '@ethersproject/abstract-signer'
import { BaseApiParams, BaseWalletAPI } from './BaseWalletAPI'
import { TransactionDetailsForUserOp } from './TransactionDetailsForUserOp';
import { TransactionRequest, flattenAuxTransactions, toSodiumTransactions, sodiumTxAbiEncode, Transaction } from '@0xsodium/transactions';
import { getWalletInitCode } from '@0xsodium/config';
import { SodiumEstimator, OverwriterEstimator, OverwriterEstimatorDefaults } from '@0xsodium/estimator';
import { JsonRpcProvider } from '@ethersproject/providers';
import { PaymasterInfo } from './types';
import { AddressZero } from '@0xsodium/utils';
import { NetworkConfig } from '@0xsodium/network';

/**
 * constructor params, added no top of base params:
 * @param owner the signer object for the wallet owner
 * @param factoryAddress address of contract "factory" to deploy new contracts (not needed if wallet already deployed)
 * @param index nonce value used when creating multiple wallets for the same owner
 */
export interface WalletApiParams extends BaseApiParams {
  signer: Signer
}

/**
 * An implementation of the BaseWalletAPI using the SimpleWallet contract.
 * - contract deployer gets "entrypoint", "owner" addresses and "index" nonce
 * - owner signs requests using normal "Ethereum Signed Message" (ether's signer.signMessage())
 * - nonce method is "nonce()"
 * - execute method is "execFromEntryPoint()"
 */
export class WalletAPI extends BaseWalletAPI {
  signer: Signer

  /**
   * our wallet contract.
   * should support the "execFromEntryPoint" and "nonce" methods
   */
  walletContract?: Sodium

  sodiumEstimator: SodiumEstimator

  constructor(params: WalletApiParams) {
    super(params)
    this.signer = params.signer
    const overwriterEstimator = new OverwriterEstimator({
      rpc: this.provider
    });
    this.sodiumEstimator = new SodiumEstimator(overwriterEstimator)
  }

  setProvider(provider: JsonRpcProvider): void {
    super.setProvider(provider);
    const overwriterEstimator = new OverwriterEstimator({
      rpc: this.provider
    });
    this.sodiumEstimator = new SodiumEstimator(overwriterEstimator)
  }

  async _getWalletContract(): Promise<Sodium> {
    if (this.walletContract == null) {
      this.walletContract = Sodium__factory.connect(await this.getWalletAddress(), this.provider)
    }
    return this.walletContract
  }

  async getWalletInitCode(): Promise<string> {
    return getWalletInitCode(this.signer, this.walletConfig, this.walletContext);
  }

  async getNonce(): Promise<BigNumber> {
    if (await this.checkWalletPhantom()) {
      return BigNumber.from(0)
    }
    const walletContract = await this._getWalletContract()
    return await walletContract.nonce()
  }

  /**
   * encode a method call from entryPoint to our contract
   */
  async encodeExecute(entryPointAddress: string, transactions: TransactionDetailsForUserOp): Promise<string> {
    const walletContract = await this._getWalletContract();
    const txs = await toSodiumTransactions(flattenAuxTransactions(transactions));
    const encodeTxs = sodiumTxAbiEncode(txs);

    return walletContract.interface.encodeFunctionData(
      'execute',
      [
        encodeTxs
      ]
    );
  }

  async encodeGasLimit(entryPointAddress: string, transactions: TransactionRequest): Promise<[Transaction[], BigNumber]> {
    const txs = await toSodiumTransactions(flattenAuxTransactions(transactions));
    const estimateResult = await this.sodiumEstimator.estimateGasLimits(entryPointAddress, this.walletConfig, this.walletContext, ...txs);
    return [
      estimateResult.transactions,
      estimateResult.total
    ];
  }

  async getPaymasterInfos(network: NetworkConfig, entryPointAddress: string, transactions: TransactionRequest): Promise<PaymasterInfo[]> {
    const tempOp = await this.createUnsignedUserOp(entryPointAddress, transactions);
    const op = await resolveProperties(tempOp);
    const totalLimit = BigNumber.from(op.verificationGasLimit).add(op.callGasLimit);
    const gasPrice = BigNumber.from(op.maxFeePerGas).mul(totalLimit);

    //TODO support more token with paymasterAPI
    return [
      {
        id: "0x",
        token: {
          address: AddressZero,
          chainId: this.chainId,
          isNativeToken: true,
          name: network.name,
          symbol: network.nativeTokenSymbol,
          decimals: 18,
          centerData: network.centerData ?? {},
        },
        amount: gasPrice,
        expiry: parseInt(`${new Date().getTime() / 1000}`) + 86400
      }
    ];
  }

  async signRequestId(requestId: string): Promise<string> {
    return await this.signer.signMessage(arrayify(requestId))
  }

  /**
   * calculate the wallet address even before it is deployed.
   * We know our factory: it just calls CREATE2 to construct the wallet.
   * NOTE: getWalletAddress works with any contract/factory (but only before creation)
   * This method is tied to SimpleWallet implementation
   */
  async getCreate2Address(): Promise<string> {
    // TODO
    return "0x";
  }
}
