import { Signer, Wallet, constants, utils } from 'ethers';
import { JsonRpcProvider, JsonRpcSigner, Provider, TransactionRequest, TransactionResponse, } from '@ethersproject/providers'
import { defineReadOnly, shallowCopy, resolveProperties } from '@ethersproject/properties'
import { Logger } from "@ethersproject/logger";
import { erc4337RuntimeVersion } from '@0xsodium/utils';
const logger = new Logger(erc4337RuntimeVersion);

const errorGas = ["call", "estimateGas"];

function spelunk(value: any, requireData: boolean): null | { message: string, data: null | string } {
    if (value == null) { return null; }

    // These *are* the droids we're looking for.
    if (typeof (value.message) === "string" && value.message.match("reverted")) {
        const data = utils.isHexString(value.data) ? value.data : null;
        if (!requireData || data) {
            return { message: value.message, data };
        }
    }

    // Spelunk further...
    if (typeof (value) === "object") {
        for (const key in value) {
            const result = spelunk(value[key], requireData);
            if (result) { return result; }
        }
        return null;
    }

    // Might be a JSON string we can further descend...
    if (typeof (value) === "string") {
        try {
            return spelunk(JSON.parse(value), requireData);
        } catch (error) { }
    }

    return null;
}

function checkError(method: string, error: any, params: any): any {

    const transaction = params.transaction || params.signedTransaction;

    // Undo the "convenience" some nodes are attempting to prevent backwards
    // incompatibility; maybe for v6 consider forwarding reverts as errors
    if (method === "call") {
        const result = spelunk(error, true);
        if (result) { return result.data; }

        // Nothing descriptive..
        logger.throwError("missing revert data in call exception; Transaction reverted without a reason string", Logger.errors.CALL_EXCEPTION, {
            data: "0x", transaction, error
        });
    }

    if (method === "estimateGas") {
        // Try to find something, with a preference on SERVER_ERROR body
        let result = spelunk(error.body, false);
        if (result == null) { result = spelunk(error, false); }

        // Found "reverted", this is a CALL_EXCEPTION
        if (result) {
            logger.throwError("cannot estimate gas; transaction may fail or may require manual gas limit", Logger.errors.UNPREDICTABLE_GAS_LIMIT, {
                reason: result.message, method, transaction, error
            });
        }
    }

    // @TODO: Should we spelunk for message too?

    let message = error.message;
    if (error.code === Logger.errors.SERVER_ERROR && error.error && typeof (error.error.message) === "string") {
        message = error.error.message;
    } else if (typeof (error.body) === "string") {
        message = error.body;
    } else if (typeof (error.responseText) === "string") {
        message = error.responseText;
    }
    message = (message || "").toLowerCase();

    // "insufficient funds for gas * price + value + cost(data)"
    if (message.match(/insufficient funds|base fee exceeds gas limit|InsufficientFunds/i)) {
        logger.throwError("insufficient funds for intrinsic transaction cost", Logger.errors.INSUFFICIENT_FUNDS, {
            error, method, transaction
        });
    }

    // "nonce too low"
    if (message.match(/nonce (is )?too low/i)) {
        logger.throwError("nonce has already been used", Logger.errors.NONCE_EXPIRED, {
            error, method, transaction
        });
    }

    // "replacement transaction underpriced"
    if (message.match(/replacement transaction underpriced|transaction gas price.*too low/i)) {
        logger.throwError("replacement fee too low", Logger.errors.REPLACEMENT_UNDERPRICED, {
            error, method, transaction
        });
    }

    // "replacement transaction underpriced"
    if (message.match(/only replay-protected/i)) {
        logger.throwError("legacy pre-eip-155 transactions not supported", Logger.errors.UNSUPPORTED_OPERATION, {
            error, method, transaction
        });
    }

    if (errorGas.indexOf(method) >= 0 && message.match(/gas required exceeds allowance|always failing transaction|execution reverted|revert/)) {
        logger.throwError("cannot estimate gas; transaction may fail or may require manual gas limit", Logger.errors.UNPREDICTABLE_GAS_LIMIT, {
            error, method, transaction
        });
    }

    throw error;
}

export class UncheckedJsonRpcSigner extends Signer {
    readonly provider: JsonRpcProvider;
    readonly signer: Wallet;

    constructor(signer: Wallet, provider: JsonRpcProvider) {
        super();
        defineReadOnly(this, "signer", signer);
        defineReadOnly(this, "provider", provider);
    }

    connect(_provider: Provider): Signer {
        return {} as Signer;
    }

    getAddress(): Promise<string> {
        return this.signer.getAddress();
    }

    async sendTransaction(transaction: utils.Deferrable<TransactionRequest>): Promise<TransactionResponse> {
        return this.sendUncheckedTransaction(transaction).then((hash) => {
            return <TransactionResponse>{
                hash: hash,
                nonce: transaction.nonce,
                gasLimit: transaction.gasLimit,
                gasPrice: transaction.gasPrice,
                data: transaction.data,
                value: transaction.value,
                chainId: transaction.chainId,
                confirmations: 0,
                from: transaction.from,
                wait: (confirmations?: number) => { return this.provider.waitForTransaction(hash, confirmations); }
            };
        });
    }

    async sendUncheckedTransaction(transaction: utils.Deferrable<TransactionRequest>): Promise<string> {
        transaction = shallowCopy(transaction);

        const fromAddress = this.getAddress().then((address) => {
            if (address) { address = address.toLowerCase(); }
            return address;
        });

        // The JSON-RPC for eth_sendTransaction uses 90000 gas; if the user
        // wishes to use this, it is easy to specify explicitly, otherwise
        // we look it up for them.
        if (transaction.gasLimit == null) {
            const estimate = shallowCopy(transaction);
            estimate.from = fromAddress;
            transaction.gasLimit = this.provider.estimateGas(estimate);
        }

        if (transaction.to != null) {
            transaction.to = Promise.resolve(transaction.to).then(async (to) => {
                if (to == null) { return undefined; }
                const address = await this.provider.resolveName(to);
                if (address == null) {
                    return logger.throwArgumentError("provided ENS name resolves to null", "tx.to", to);
                }
                return address;
            });
        }

        return resolveProperties({
            tx: resolveProperties(transaction),
            sender: fromAddress
        }).then(({ tx, sender }) => {
            if (tx.from != null) {
                if (tx.from.toLowerCase() !== sender) {
                    logger.throwArgumentError("from address mismatch", "transaction", transaction);
                }
            } else {
                tx.from = sender;
            }
            return this.signTransaction(tx).then(signedTx => {
                console.debug("start send");
                return this.provider.send("eth_sendRawTransaction", [signedTx]).then((hash) => {
                    return hash;
                }, (error) => {
                    console.debug(error, "error");
    
                    if (typeof (error.message) === "string" && error.message.match(/user denied/i)) {
                        logger.throwError("user rejected transaction", Logger.errors.ACTION_REJECTED, {
                            action: "sendTransaction",
                            transaction: tx
                        });
                    }
    
                    return checkError("sendTransaction", error, signedTx);
                });
            });
        });
    }

    async signMessage(message: utils.Bytes | string): Promise<string> {
        return this.signer.signMessage(message);
    }

    async signTransaction(_transaction: utils.Deferrable<TransactionRequest>): Promise<string> {
        const tx = await this.populateTransaction(_transaction);
        return this.signer.signTransaction(tx);
    }
}