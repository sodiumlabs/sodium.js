import { WalletContext } from '@0xsodium/network';
import { WalletConfig, addressOf } from '@0xsodium/config';
import { sodiumTxAbiEncode, Transaction } from '@0xsodium/transactions';
import { OverwriterEstimator } from './overwriter-estimator';
import { BigNumber, ethers } from 'ethers';
import { Sodium__factory } from '@0xsodium/wallet-contracts';
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
        code: "0x608060405234801561001057600080fd5b506004361061002b5760003560e01c80630eb34cd314610030575b600080fd5b61004361003e3660046100eb565b61005b565b60405161005293929190610189565b60405180910390f35b600060606000805a90508673ffffffffffffffffffffffffffffffffffffffff16868660405161008c929190610206565b6000604051808303816000865af19150503d80600081146100c9576040519150601f19603f3d011682016040523d82523d6000602084013e6100ce565b606091505b5090945092505a6100df9082610216565b91505093509350939050565b60008060006040848603121561010057600080fd5b833573ffffffffffffffffffffffffffffffffffffffff8116811461012457600080fd5b9250602084013567ffffffffffffffff8082111561014157600080fd5b818601915086601f83011261015557600080fd5b81358181111561016457600080fd5b87602082850101111561017657600080fd5b6020830194508093505050509250925092565b831515815260006020606081840152845180606085015260005b818110156101bf578681018301518582016080015282016101a3565b5060006080828601015260807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0601f83011685010192505050826040830152949350505050565b8183823760009101908152919050565b81810381811115610250577f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b9291505056fea2646970667358221220409f4bdeae77ebb48b92e7e2315711cc1dc14906b4aae9326ccef5c71811a0e764736f6c63430008110033"
      }
    }

    const from = context.entryPointAddress;
    const estimates = await Promise.all([
      ...encoded.map(async (tx, i) => {
        return this.estimator.estimate({
          to: wallet,
          from: from,
          data: walletInterface.encodeFunctionData('execute', [
            encoded.slice(0, i+1)
          ]),
          overwrites: sodiumOverwrites
        })
      }),
    ])

    const txs = transactions.map((t, i) => {
      if (i == 0) {
        return { ...t, gasLimit: estimates[i] };
      }
      return { ...t, gasLimit: estimates[i].sub(estimates[i-1]) };
    });
    return {
      transactions: txs,
      // total: BigNumber.from(estimates[estimates.length - 1]).add(1000000),
      total: txs.map(t => t.gasLimit).reduce((p, c) => {
        return c.add(p);
      }, BigNumber.from(100000))
    }
  }
}