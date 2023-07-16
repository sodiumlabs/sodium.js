import { ethers } from 'ethers'
import { Proof, ValidatorFunc, IsValidSignatureBytes32MagicValue } from '@0xsequence/ethauth'
import { SodiumContext, createContext } from '@0xsodium/network'
import { isValidSodiumUndeployedWalletSignature } from '@0xsodium/wallet'

export const ValidateSodiumDeployedWalletProof: ValidatorFunc = async (provider: ethers.providers.JsonRpcProvider, chainId: number, proof: Proof): Promise<{ isValid: boolean, address?: string }> => {
  if (!provider || provider === undefined || chainId === undefined) {
    return { isValid: false }
  }

  // Compute eip712 message digest from the proof claims
  const digest = proof.messageDigest()

  // Early check to ensure the contract wallet has been deployed
  const walletCode = await provider.getCode(proof.address)
  if (walletCode === '0x' || walletCode.length <= 2) {
    throw new Error('ValidateSequenceDeployedWalletProof failed. unable to fetch wallet contract code')
  }

  // Call EIP-1271 IsValidSignature(bytes32, bytes) method on the deployed wallet. Note: for undeployed
  // wallets, you will need to implement your own ValidatorFunc with the additional context.
  const abi = [ 'function isValidSignature(bytes32, bytes) public view returns (bytes4)' ]
  const contract = new ethers.Contract(proof.address, abi, provider)

  // hash the message digest as required by isValidSignature
  const isValidSignature = await contract.isValidSignature(digest, ethers.utils.arrayify(proof.signature))

  if (isValidSignature === IsValidSignatureBytes32MagicValue) {
    return { isValid: true }
  } else {
    return { isValid: false }
  }
}

export const ValidateSodiumUndeployedWalletProof = (context?: SodiumContext): ValidatorFunc => {
  return async (
    provider: ethers.providers.JsonRpcProvider,
    chainId: number,
    proof: Proof
  ): Promise<{ isValid: boolean, address?: string }> => {
    if (!provider || provider === undefined || chainId === undefined) {
      return { isValid: false }
    }

    // The contract must not be deployed
    const walletCode = ethers.utils.arrayify(await provider.getCode(proof.address))
    if (walletCode.length !== 0) return { isValid: false }

    // Compute eip712 message digest from the proof claims
    const message = proof.messageDigest()

    // hash the message digest as required by isValidSignature
    const digest = ethers.utils.arrayify(ethers.utils.keccak256(message))

    const isValid = await isValidSodiumUndeployedWalletSignature(
      proof.address,
      digest,
      proof.signature,
      createContext(context),
      provider,
      chainId
    )

    return { isValid: !!isValid }
  }
}
