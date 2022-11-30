import { JsonRpcProvider } from '@ethersproject/providers';
import { EntryPoint__factory } from '@0xsodium/wallet-contracts';
import { ClientConfig } from './ClientConfig';
import { WalletAPI } from './WalletAPI';
import { ERC4337EthersProvider } from './ERC4337EthersProvider';
import { HttpRpcClient } from './HttpRpcClient';
import { Signer } from '@ethersproject/abstract-signer';
import Debug from 'debug';

const debug = Debug('aa.wrapProvider');

// /**
//  * wrap an existing provider to tunnel requests through Account Abstraction.
//  * @param originalProvider the normal provider
//  * @param config see ClientConfig for more info
//  * @param originalSigner use this signer as the owner. of this wallet. By default, use the provider's signer
//  */
// export async function wrapProvider(
//   originalProvider: JsonRpcProvider,
//   config: ClientConfig,
//   originalSigner: Signer = originalProvider.getSigner()
// ): Promise<ERC4337EthersProvider> {
//   const entryPoint = EntryPoint__factory.connect(config.entryPointAddress, originalProvider)
//   // Initial SimpleWallet instance is not deployed and exists just for the interface
//   const smartWalletAPI = new WalletAPI({
//     entryPointAddress: entryPoint.address,
//     signer: originalSigner,
//     paymasterAPI: config.paymasterAPI
//   })
//   const chainId = await originalProvider.getNetwork().then(net => net.chainId)
//   smartWalletAPI.setProvider(originalProvider);
//   smartWalletAPI.setBundler(config.bundlerUrl, chainId);
//   const httpRpcClient = new HttpRpcClient(config.bundlerUrl, config.entryPointAddress, chainId)
//   return await new ERC4337EthersProvider(
//     chainId,
//     config,
//     originalSigner,
//     originalProvider,
//     httpRpcClient,
//     entryPoint,
//     smartWalletAPI
//   ).init()
// }
