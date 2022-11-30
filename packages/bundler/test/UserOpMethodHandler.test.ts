import 'source-map-support/register'
import { BaseProvider, JsonRpcSigner } from '@ethersproject/providers'
import { assert, expect } from 'chai'
import { ethers } from 'hardhat'
import { parseEther } from 'ethers/lib/utils'

import { UserOpMethodHandler } from '../src/UserOpMethodHandler'

import { BundlerConfig } from '../src/BundlerConfig'
import {
  EntryPoint,
} from '@0xsodium/wallet-contracts';
import type {
  UserOperationStruct
} from '@0xsodium/wallet-contracts/gen/EntryPoint';

import { WalletAPI } from '@0xsodium/sdk4337';
import { Wallet } from 'ethers'

describe('UserOpMethodHandler', function () {
  const helloWorld = 'hello world'

  let methodHandler: UserOpMethodHandler
  let provider: BaseProvider
  let signer: JsonRpcSigner
  const walletSigner = Wallet.createRandom()

  let entryPoint: EntryPoint

  before(async function () {
    provider = ethers.provider
    signer = ethers.provider.getSigner()

    const EntryPointFactory = await ethers.getContractFactory('EntryPoint')
    // entryPoint = await EntryPointFactory.deploy(1, 1)

    // const bundleHelperFactory = await ethers.getContractFactory('BundlerHelper')
    // bundleHelper = await bundleHelperFactory.deploy()
    // console.log('bundler from=', await bundleHelper.signer.getAddress())
    // const sampleRecipientFactory = await ethers.getContractFactory('SampleRecipient')
    // sampleRecipient = await sampleRecipientFactory.deploy()

    // const config: BundlerConfig = {
    //   beneficiary: await signer.getAddress(),
    //   entryPoint: entryPoint.address,
    //   gasFactor: '0.2',
    //   minBalance: '0',
    //   mnemonic: '',
    //   network: '',
    //   port: '3000'
    // }

    // methodHandler = new UserOpMethodHandler(
    //   provider,
    //   signer,
    //   config,
    //   entryPoint
    // )
  })

  describe('eth_supportedEntryPoints', function () {
    it('eth_supportedEntryPoints', async () => {
      await expect(await methodHandler.getSupportedEntryPoints()).to.eql([entryPoint.address])
    })
  })

  describe('sendUserOperation', function () {
    let userOperation: UserOperationStruct
    let walletAddress: string

    let walletDeployerAddress: string
    before(async function () {
      // DeterministicDeployer.init(ethers.provider)
      // walletDeployerAddress = await DeterministicDeployer.deploy(SimpleWalletDeployer__factory.bytecode)

      const smartWalletAPI = new WalletAPI({
        provider,
        entryPointAddress: entryPoint.address,
        owner: walletSigner,
      })
      walletAddress = await smartWalletAPI.getWalletAddress()
      await signer.sendTransaction({
        to: walletAddress,
        value: parseEther('1')
      })
    })

    it('should expose FailedOp errors as text messages', async () => {
      const smartWalletAPI = new WalletAPI({
        provider,
        entryPointAddress: entryPoint.address,
        owner: walletSigner,
        index: 1
      })
      // const op = await smartWalletAPI.createSignedUserOp({
      //   data: sampleRecipient.interface.encodeFunctionData('something', [helloWorld]),
      //   target: sampleRecipient.address
      // })

      // try {
      //   await methodHandler.sendUserOperation(op, entryPoint.address)
      //   throw Error('expected fail')
      // } catch (e: any) {
      //   expect(e.message).to.match(/FailedOp.*wallet didn't pay prefund/)
      // }
    })

    describe('validate get paid enough', function () {
      it('should pay just enough', async () => {
        const api = new WalletAPI({
          provider,
          entryPointAddress: entryPoint.address,
          owner: walletSigner
        })
        // const op = await api.createSignedUserOp({
        //   data: sampleRecipient.interface.encodeFunctionData('something', [helloWorld]),
        //   target: sampleRecipient.address,
        //   gasLimit: 1e6
        // })
        // const id = await methodHandler.sendUserOperation(op, entryPoint.address)

        // {
        //   console.log('wrong method')
        //   await methodHandler.sendUserOperation(await api.createSignedUserOp({
        //     data: sampleRecipient.interface.encodeFunctionData('something', [helloWorld + helloWorld + helloWorld + helloWorld + helloWorld]).padEnd(2000, '1'),
        //     target: walletAddress,
        //     gasLimit: 1e6
        //
        //   }), entryPoint.address)
        // }
        //
        // {
        //   console.log('self nonce')
        //   const data = keccak256(Buffer.from('nonce()')).slice(0, 10)
        //   await methodHandler.sendUserOperation(await api.createSignedUserOp({
        //     data: data,
        //     target: walletAddress,
        //     gasLimit: 1e6
        //
        //   }), entryPoint.address)
        // }

        // await postExecutionDump(entryPoint, id)
      })
      it('should reject if doesn\'t pay enough', async () => {
        const api = new WalletAPI({
          provider,
          entryPointAddress: entryPoint.address,
          owner: walletSigner,
          overheads: { perUserOp: 0 }
        })
        // const op = await api.createSignedUserOp({
        //   data: sampleRecipient.interface.encodeFunctionData('something', [helloWorld]),
        //   target: sampleRecipient.address
        // })
        // try {
        //   await methodHandler.sendUserOperation(op, entryPoint.address)
        //   throw new Error('expected to revert')
        // } catch (e: any) {
        //   expect(e.message).to.match(/preVerificationGas too low/)
        // }
      })
    })
  })
})
