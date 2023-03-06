import { WalletConfig } from "@0xsodium/config"
import { WalletContext } from "@0xsodium/network"
import { Transaction } from "@0xsodium/transactions"
import { ethers } from "ethers"

export interface Estimator {
  estimateGasLimits(
    entryPointAddress: string,
    config: WalletConfig,
    context: WalletContext,
    ...transactions: Transaction[]
  ): Promise<{
    transactions:Transaction[],
    total: ethers.BigNumber
  }>
}
