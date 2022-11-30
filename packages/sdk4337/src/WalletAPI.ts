import { BigNumber, BigNumberish } from 'ethers'
import {
  Sodium,
  Sodium__factory
} from '@0xsodium/wallet-contracts';
import { arrayify } from 'ethers/lib/utils'
import { Signer } from '@ethersproject/abstract-signer'
import { BaseApiParams, BaseWalletAPI } from './BaseWalletAPI'
import { TransactionDetailsForUserOp } from './TransactionDetailsForUserOp';
import { TransactionRequest, flattenAuxTransactions, sodiumTxAbiEncode } from '@0xsodium/transactions';
import { getWalletInitCode, WalletConfig } from '@0xsodium/config'; 

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

  constructor(params: WalletApiParams) {
    super(params)
    this.signer = params.signer
  }

  async _getWalletContract(): Promise<Sodium> {
    if (this.walletContract == null) {
      this.walletContract = Sodium__factory.connect(await this.getWalletAddress(), this.provider)
    }
    return this.walletContract
  }

  async getWalletInitCode(): Promise<string> {
    return getWalletInitCode(this.walletConfig, this.walletContext);
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
    const txs = flattenAuxTransactions(transactions);
    return walletContract.interface.encodeFunctionData(
      'execute',
      [
        sodiumTxAbiEncode(txs)
      ]
    );
  }

  async encodeGasLimit(transactions: TransactionRequest): Promise<BigNumber> {
    const txs = flattenAuxTransactions(transactions);
    return txs.reduce((c, t) => {
      if (t.gasLimit) {
        return c.add(t.gasLimit);
      }
      return c;
    }, BigNumber.from(0));
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
