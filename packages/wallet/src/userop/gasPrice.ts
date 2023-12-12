import { NetworkConfig } from "@0xsodium/network";
import { ethers } from "ethers";
import {
  UserOperationMiddlewareFn,
} from 'userop';

const eip1559GasPrice = async (
  provider: ethers.providers.JsonRpcProvider,
  network: NetworkConfig
) => {
  const [fee, block] = await Promise.all([
    provider.send("eth_maxPriorityFeePerGas", []),
    provider.getBlock("latest"),
  ]);

  if (!block.baseFeePerGas) {
    return {
      maxFeePerGas: ethers.BigNumber.from(fee),
      maxPriorityFeePerGas: ethers.BigNumber.from(fee),
    }
  }

  const tip = ethers.BigNumber.from(fee);
  let maxPriorityFeePerGas = ethers.BigNumber.from(0);
  if (network.maxPriorityFeePerGasBuffer) {
    maxPriorityFeePerGas = tip.mul(network.maxPriorityFeePerGasBuffer).div(100);
  }

  let maxFeePerGas = block.baseFeePerGas;

  if (network.maxGasPriceMultiplier) {
    maxFeePerGas = maxFeePerGas.mul(network.maxGasPriceMultiplier);
  }


  return { maxFeePerGas, maxPriorityFeePerGas };
};

const legacyGasPrice = async (provider: ethers.providers.JsonRpcProvider, network: NetworkConfig) => {
  const gas = await provider.getGasPrice();

  return { maxFeePerGas: gas, maxPriorityFeePerGas: gas };
};

export const getGasPrice =
  (provider: ethers.providers.JsonRpcProvider, network: NetworkConfig): UserOperationMiddlewareFn =>
    async (ctx) => {
      let eip1559Error;
      try {
        const { maxFeePerGas, maxPriorityFeePerGas } = await eip1559GasPrice(
          provider,
          network
        );

        ctx.op.maxFeePerGas = maxFeePerGas;
        ctx.op.maxPriorityFeePerGas = maxPriorityFeePerGas;
        return;
      } catch (error: any) {
        eip1559Error = error;
        console.warn(
          "getGas: eth_maxPriorityFeePerGas failed, falling back to legacy gas price."
        );
      }

      try {
        const { maxFeePerGas, maxPriorityFeePerGas } = await legacyGasPrice(
          provider,
          network
        );

        ctx.op.maxFeePerGas = maxFeePerGas;
        ctx.op.maxPriorityFeePerGas = maxPriorityFeePerGas;
        return;
      } catch (error) {
        throw new Error(`${eip1559Error}, ${error}`);
      }
    };
