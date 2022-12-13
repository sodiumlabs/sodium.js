import { WalletContext } from '@0xsodium/network';
import { WalletConfig, addressOf } from '@0xsodium/config';
import { sodiumTxAbiEncode, Transaction } from '@0xsodium/transactions';
import { OverwriterEstimator } from './overwriter-estimator';
import { BigNumber, ethers } from 'ethers';
import { GasEstimator__factory, Sodium__factory } from '@0xsodium/wallet-contracts';
import { Estimator } from './estimator';

export class SodiumEstimator implements Estimator {
  constructor(public estimator: OverwriterEstimator) {

  }

  async estimateGasLimits(config: WalletConfig, context: WalletContext, ...transactions: Transaction[]): Promise<{ transactions: Transaction[], total: ethers.BigNumber }> {
    const wallet = addressOf(config, context)
    const walletInterface = Sodium__factory.createInterface();
    const encoded = sodiumTxAbiEncode(transactions)
    const sodiumOverwrites = {
      [context.entryPointAddress]: {
        code: GasEstimator__factory.bytecode
      }
    }
    const estimates = await Promise.all([
      ...encoded.map(async (tx, i) => {
        // If the user specifies a gas limit, an additional amount is added as the cost of execution for the "execute" function.
        if (BigNumber.from(tx.gasLimit).gt(0)) {
          return BigNumber.from(tx.gasLimit).add(10000);
        }
        return this.estimator.estimate({
          to: wallet,
          from: context.entryPointAddress,
          data: walletInterface.encodeFunctionData('execute', [
            encoded.slice(0, i)
          ]),
          overwrites: sodiumOverwrites
        })
      }),
      this.estimator.estimate({
        to: wallet,
        from: context.entryPointAddress,
        data: walletInterface.encodeFunctionData('execute', [
          encoded
        ]),
        overwrites: sodiumOverwrites
      })
    ])

    return {
      transactions: transactions.map((t, i) => {
        return { ...t, gasLimit: t.gasLimit };
      }),
      total: BigNumber.from(estimates[estimates.length - 1])
    }
  }
}