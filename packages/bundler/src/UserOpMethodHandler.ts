import { BigNumber, Wallet, ethers } from 'ethers'
import { JsonRpcProvider, JsonRpcSigner, Provider } from '@ethersproject/providers'
import { BundlerConfig } from './BundlerConfig'
import { EntryPoint } from '@0xsodium/wallet-contracts';
import type { UserOperationStruct, UserOperationEventEvent } from '@0xsodium/wallet-contracts/gen/adapter/contracts/eip4337/core/EntryPoint';
import { hexValue, resolveProperties } from 'ethers/lib/utils';
import { rethrowError, AddressZero } from '@0xsodium/utils';
import { deepHexlify, requireCond, RpcError } from './utils'
import { calcPreVerificationGas } from '@0xsodium/sdk4337';
import { debug_traceCall } from './GethTracer'
import { BundlerCollectorReturn, bundlerCollectorTracer } from './BundlerCollectorTracer'
import Debug from 'debug'

const debug = Debug('aa.handler.userop');
const HEX_REGEX = /^0x[a-fA-F\d]*$/i
const userOpCache: {
  [key: string]: string
} = {};

export class UserOpMethodHandler {
  constructor (
    readonly provider: Provider,
    readonly signer: Wallet | JsonRpcSigner,
    readonly config: BundlerConfig,
    readonly entryPoint: EntryPoint
  ) {
  }

  clientVersion?: string

  async isGeth (): Promise<boolean> {
    if (this.clientVersion == null) {
      this.clientVersion = await (this.provider as JsonRpcProvider).send('web3_clientVersion', [])
    }
    return this.clientVersion?.match('Geth') != null
  }

  async getSupportedEntryPoints (): Promise<string[]> {
    return [this.config.entryPoint]
  }

  async selectBeneficiary (): Promise<string> {
    return this.config.beneficiary;
    const currentBalance = await this.provider.getBalance(this.signer.getAddress())
    let beneficiary = this.config.beneficiary
    // below min-balance redeem to the signer, to keep it active.
    if (currentBalance.lte(this.config.minBalance)) {
      beneficiary = await this.signer.getAddress()
      console.log('low balance. using ', beneficiary, 'as beneficiary instead of ', this.config.beneficiary)
    }
    return beneficiary
  }

  async validateUserOperation (userOp1: UserOperationStruct, requireSignature = true): Promise<void> {
    // minimal sanity check: userOp exists, and all members are hex
    requireCond(userOp1 != null, 'No UserOperation param')
    const userOp = await resolveProperties(userOp1) as any

    const fieldNames = 'sender,nonce,initCode,callData,callGasLimit,verificationGasLimit,preVerificationGas,maxFeePerGas,maxPriorityFeePerGas,paymasterAndData'
    const fields = fieldNames.split(',')
    if (requireSignature) {
      fields.push('signature')
    }
    fields.forEach(key => {
      requireCond(userOp[key] != null, 'Missing userOp field: ' + key + JSON.stringify(userOp), -32602)
      const value: string = userOp[key].toString()
      requireCond(value.match(HEX_REGEX) != null, `Invalid hex value for property ${key}:${value} in UserOp`, -32602)
    })
  }

  /**
   * simulate UserOperation.
   * Note that simulation requires debug API:
   * - debug_traceCall, to trace the call.
   * @param userOp1
   * @param entryPointInput
   */
  async simulateUserOp (userOp1: UserOperationStruct, entryPointInput: string): Promise<void> {
    const userOp = deepHexlify(await resolveProperties(userOp1))

    await this.validateUserOperation(userOp, false)
    requireCond(entryPointInput != null, 'No entryPoint param')

    if (entryPointInput.toLowerCase() !== this.config.entryPoint.toLowerCase()) {
      throw new Error(`The EntryPoint at "${entryPointInput}" is not supported. This bundler uses ${this.config.entryPoint}`)
    }
    const simulateCall = this.entryPoint.interface.encodeFunctionData('simulateValidation', [userOp])

    const revert = await this.entryPoint.callStatic.simulateValidation(userOp, { gasLimit: 10e6 }).catch(e => e)
    // simulation always reverts...
    if (revert.errorName === 'FailedOp') {
      let data: any
      if (revert.errorArgs.paymaster !== AddressZero) {
        data = { paymaster: revert.errorArgs.paymaster }
      }
      throw new RpcError(revert.errorArgs.reason, -32500, data)
    }
    const provider = this.provider as JsonRpcProvider
    if (await this.isGeth()) {
      debug('=== sending simulate')
      const simulationGas = BigNumber.from(50000).add(userOp.verificationGasLimit)
      const result: BundlerCollectorReturn = await debug_traceCall(provider, {
        from: ethers.constants.AddressZero,
        to: this.entryPoint.address,
        data: simulateCall,
        gasLimit: simulationGas
      }, { tracer: bundlerCollectorTracer })
      const bannedOpCodes = new Set(['GASPRICE', 'GASLIMIT', 'DIFFICULTY', 'TIMESTAMP', 'BASEFEE', 'BLOCKHASH', 'NUMBER', 'SELFBALANCE', 'BALANCE', 'ORIGIN', 'GAS', 'CREATE', 'COINBASE'])
      const paymaster = (userOp.paymasterAndData?.length ?? 0) >= 42 ? userOp.paymasterAndData.toString().slice(0, 42) : undefined
      const validateOpcodes = result.numberLevels['0'].opcodes
      const validatePaymasterOpcodes = result.numberLevels['1'].opcodes
      // console.log('debug=', result.debug.join('\n- '))
      Object.keys(validateOpcodes).forEach(opcode =>
        requireCond(!bannedOpCodes.has(opcode), `account uses banned opcode: ${opcode}`, 32501)
      )
      Object.keys(validatePaymasterOpcodes).forEach(opcode =>
        requireCond(!bannedOpCodes.has(opcode), `paymaster uses banned opcode: ${opcode}`, 32501, { paymaster })
      )
      if (userOp.initCode.length > 2) {
        requireCond((validateOpcodes.CREATE2 ?? 0) <= 1, 'initCode with too many CREATE2', 32501)
      } else {
        requireCond((validateOpcodes.CREATE2 ?? 0) < 1, 'banned opcode: CREATE2', 32501)
      }
      requireCond((validatePaymasterOpcodes.CREATE2 ?? 0) < 1, 'paymaster uses banned opcode: CREATE2', 32501, { paymaster })
    }
  }

  async sendUserOperation (userOp1: UserOperationStruct, entryPointInput: string): Promise<string> {
    const userOp = await resolveProperties(userOp1)
    if (entryPointInput.toLowerCase() !== this.config.entryPoint.toLowerCase()) {
      throw new Error(`The EntryPoint at "${entryPointInput}" is not supported. This bundler uses ${this.config.entryPoint}`)
    }
    console.log(`UserOperation: Sender=${userOp.sender} EntryPoint=${entryPointInput} Paymaster=${hexValue(userOp.paymasterAndData)}`)
    // await this.simulateUserOp(userOp1, entryPointInput)
    const beneficiary = await this.selectBeneficiary()
    const expectedPreVerificationGas = calcPreVerificationGas(userOp)
    const preVerificationGas = BigNumber.from(await userOp.preVerificationGas).toNumber()
    if (expectedPreVerificationGas > preVerificationGas) {
      throw new Error(`userOp.preVerificationGas too low: expected ${expectedPreVerificationGas} but got ${preVerificationGas}`)
    }
    console.debug("start ops");
    const gasLimit = BigNumber.from(2e7);
    // const gasLimit = undefined;
    // debug('using gasLimit=', gasLimit)
    const [ txr, userOpHash ] = await Promise.all([
      this.entryPoint.handleOps([userOp], beneficiary, { 
        gasLimit,
        maxFeePerGas: userOp.maxFeePerGas,
        maxPriorityFeePerGas: userOp.maxPriorityFeePerGas
      }).catch(rethrowError),
      this.entryPoint.getUserOpHash(userOp),
    ]);

    console.debug(txr.hash, "txhash");
    userOpCache[userOpHash] = txr.hash;
    
    return userOpHash
  }

  async getTransactionHashByUserOpHash(userOpHash: string): Promise<string> {
    return userOpCache[userOpHash];
  }

  async _getUserOperationEvent (userOpHash: string): Promise<UserOperationEventEvent> {
    const event = await this.entryPoint.queryFilter(this.entryPoint.filters.UserOperationEvent(userOpHash))
    return event[0]
  }

  async getUserOperationReceipt (userOpHash: string): Promise<any> {
    requireCond(userOpHash?.toString()?.match(HEX_REGEX) != null, 'Missing/invalid userOpHash', -32601)
    const event = await this._getUserOperationEvent(userOpHash)
    if (event == null) {
      return null
    }
    const receipt = await event.getTransactionReceipt() as any
    receipt.status = event.args.success ? 1 : 0
    receipt.userOpHash = userOpHash
    return deepHexlify(receipt)
  }

  async getUserOperationTransactionByHash (userOpHash: string): Promise<any> {
    requireCond(userOpHash?.toString()?.match(HEX_REGEX) != null, 'Missing/invalid userOpHash', -32601)
    const event = await this._getUserOperationEvent(userOpHash)
    if (event == null) {
      return null
    }
    const tx = await event.getTransaction() as any
    tx.userOpHash = userOpHash
    return deepHexlify(tx)
  }
}