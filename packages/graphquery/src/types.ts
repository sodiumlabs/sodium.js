import { ERC20OrNativeTokenMetadata } from "@0xsodium/utils";
import { BigNumber } from 'ethers';

export type UserTokenInfo = {
    balance: BigNumber,
    token: ERC20OrNativeTokenMetadata,
}

export type TransactionType = "failed" | "complete";

// sent = tx.input = Keccak256("transfer(address,uint256)") and erc20Transfers only 1 and from == this
// received = erc20Transfers only 1 and to == this
// swap = erc20Transfers only 2 and erc20Transfers[0].from != erc20Transfers[1].to
// multi-all = tx.input == exec and transaction count > 1
// string = other implement config TODO::coming soon
export type TransactionPrefixName = "sent" | "received" | "swap" | "multi-all" | string;
export type TransactionERC20Transfer = {
    from: string;
    to: string;
    amount: string;
    token: ERC20OrNativeTokenMetadata;
};
export type TransactionBlock = {
    blockNumber: string;
    blockTimestamp: number;
};
export type TransactionHistory = {
    type: TransactionType,
    transactionHash: string,
    input: string,
    block: TransactionBlock,
    // eip4337
    userOpHash: string,
    erc20Transfers: TransactionERC20Transfer[]
    // coming soon
    erc1155Transfers: any[]
    // coming soon
    erc721Transfers: any[]
    prefix: TransactionPrefixName
}