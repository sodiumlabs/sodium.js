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
  async encodeExecute(transactions: TransactionDetailsForUserOp): Promise<string> {
    const walletContract = await this._getWalletContract();
    const txs = await toSodiumTransactions(flattenAuxTransactions(transactions));

    console.debug(txs, "txs");

    return walletContract.interface.encodeFunctionData(
      'execute',
      [
        sodiumTxAbiEncode(txs)
      ]
    );
  }

  async encodeGasLimit(transactions: TransactionRequest): Promise<[Transaction[], BigNumber]> {
    const txs = await toSodiumTransactions(flattenAuxTransactions(transactions));
    const estimateResult = await this.sodiumEstimator.estimateGasLimits(this.walletConfig, this.walletContext, ...txs);
    return [
      estimateResult.transactions,
      estimateResult.total
    ];
  }

  async getPaymasterInfos(transactions: TransactionRequest): Promise<PaymasterInfo[]> {
    const tempOp = await this.createUnsignedUserOp(transactions);
    const op = await resolveProperties(tempOp);
    const totalLimit = BigNumber.from(op.verificationGasLimit).add(op.callGasLimit);
    const gasPrice = BigNumber.from(op.maxFeePerGas).mul(totalLimit);

    //TODO support more token with paymasterAPI
    return [
      {
        id: "self",
        token: {
          address: AddressZero,
          chainId: 1337,
          isNativeToken: true,
          name: "Polygon",
          symbol: "MATIC",
          decimals: 18,
          centerData: {
            website: "https://polygon.technology/",
            description: "Matic Network provides scalable, secure and instant Ethereum transactions. It is built on an implementation of the PLASMA framework and functions as an off chain scaling solution. Matic Network offers scalability solutions along with other tools to the developer ecosystem, which enable Matic to seamlessly integrate with dApps while helping developers create an enhanced user experience.",
            logoURI: "https://tokens.1inch.io/0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0.png"
          },
        },
        amount: gasPrice,
        expiry: parseInt(`${new Date().getTime()/1000}`) + 86400
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
