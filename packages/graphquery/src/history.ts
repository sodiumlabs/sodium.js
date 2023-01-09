import { getBuiltGraphSDK } from './.graphclient';
import { TransactionHistory } from './types';

export const getHistories = async (
    account: string,
    chainId: number,
    first: number = 100,
    skip: number = 0,
    tokenAddress?: string
): Promise<TransactionHistory[]> => {
    const sdk = getBuiltGraphSDK();
    let result;
    if (tokenAddress) {
        result = await sdk.QueryUserTokenHistories({
            accountId: account.toLowerCase(),
            first: first,
            skip,
            tokenAddress
        });
    } else {
        result = await sdk.QueryUserHistories({
            accountId: account.toLowerCase(),
            first: first,
            skip
        });
    }

    const mapx: {
        [key: string]: TransactionHistory
    } = {};

    result.transfers.forEach(a => {
        if (!mapx[a.blockNumber]) {
            mapx[a.blockNumber] = {
                type: 'complete',
                transactionHash: a.txnHash,
                input: "",
                block: {
                    blockNumber: a.blockNumber,
                    blockTimestamp: a.blockTimestamp,
                },
                userOpHash: "",
                erc20Transfers: [
                    {
                        from: a.from.id,
                        to: a.to.id,
                        token: {
                            chainId: chainId,
                            decimals: a.token.decimals,
                            address: a.token.id,
                            symbol: a.token.symbol,
                            name: a.token.name,

                            // TODO 使用nextjs单独配置中心化信息并采集
                            centerData: {

                            }
                        },
                        amount: a.amount
                    }
                ],
                erc1155Transfers: [],
                erc721Transfers: [],
                prefix: "sent"
            }
        }
    });

    result.receives.forEach(a => {
        if (!mapx[a.blockNumber]) {
            // type: TransactionType,
            // transactionHash: string,
            // input: string,
            // block: TransactionBlock,
            // userOpHash: string,
            // erc20Transfers: TransactionERC20Transfer[]
            // // coming soon
            // erc1155Transfers: any[]
            // // coming soon
            // erc721Transfers: any[]
            // prefix: TransactionPrefixName
            mapx[a.blockNumber] = {
                type: 'complete',
                transactionHash: a.txnHash,
                input: "",
                block: {
                    blockNumber: a.blockNumber,
                    blockTimestamp: a.blockTimestamp,
                },
                userOpHash: "",
                erc20Transfers: [
                    {
                        from: a.from.id,
                        to: a.to.id,
                        token: {
                            chainId: chainId,
                            decimals: a.token.decimals,
                            address: a.token.id,
                            symbol: a.token.symbol,
                            name: a.token.name,

                            // TODO 使用nextjs单独配置中心化信息并采集
                            centerData: {

                            }
                        },
                        amount: a.amount
                    }
                ],
                erc1155Transfers: [],
                erc721Transfers: [],
                prefix: "received"
            }
        }
    });

    return Object.values(mapx);
}