const { pool } = require("../db");

const { ethers } = require("ethers");
const { TronWeb } = require("tronweb");

const BSC_RPC_URL = process.env.BSC_RPC_URL;
const BSC_USDT_CONTRACT = process.env.BSC_USDT_CONTRACT;
const BEP20_DEPOSIT_ADDRESS = process.env.BEP20_DEPOSIT_ADDRESS;

const TRON_API_URL = process.env.TRON_API_URL;
const TRC20_USDT_CONTRACT = process.env.TRC20_USDT_CONTRACT;
const TRC20_DEPOSIT_ADDRESS = process.env.TRC20_DEPOSIT_ADDRESS;

const ETH_RPC_URL = process.env.ETH_RPC_URL;
const ERC20_USDT_CONTRACT = process.env.ERC20_USDT_CONTRACT;
const ERC20_DEPOSIT_ADDRESS = process.env.ERC20_DEPOSIT_ADDRESS;

const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL;
const POLYGON_USDT_CONTRACT = process.env.POLYGON_USDT_CONTRACT;
const POLYGON_DEPOSIT_ADDRESS = process.env.POLYGON_DEPOSIT_ADDRESS;

const usdtInterface = new ethers.Interface([
    "event Transfer(address indexed from, address indexed to, uint256 value)"
]);

function getBscProvider() {
    if (!BSC_RPC_URL) {
        throw new Error("BSC_RPC_URL is not configured.");
    }

    return new ethers.JsonRpcProvider(BSC_RPC_URL);
}

function getTronWeb() {
    if (!TRON_API_URL) {
        throw new Error("TRON_API_URL is not configured.");
    }

    return new TronWeb({
        fullHost: TRON_API_URL
    });
}

function getEthProvider() {
    if (!ETH_RPC_URL) {
        throw new Error("ETH_RPC_URL is not configured.");
    }

    return new ethers.JsonRpcProvider(ETH_RPC_URL);
}

function getPolygonProvider() {
    if (!POLYGON_RPC_URL) {
        throw new Error("POLYGON_RPC_URL is not configured.");
    }

    return new ethers.JsonRpcProvider(POLYGON_RPC_URL);
}


/* ==================================================
   AVERYX DAILY REWARD CONFIGURATION
================================================== */

const INDIA_OFFSET_MINUTES = 330;


const TIERS = [

    {
        level: 1,
        name: "The Fool",
        deposit: 0,
        daily: 0
    },

    {
        level: 2,
        name: "The Prodigy",
        deposit: 3.5,
        daily: 1
    },

    {
        level: 3,
        name: "The Magician",
        deposit: 16,
        daily: 5
    },

    {
        level: 4,
        name: "The Conqueror",
        deposit: 60,
        daily: 18
    },

    {
        level: 5,
        name: "The Emperor",
        deposit: 165,
        daily: 49.5
    },

    {
        level: 6,
        name: "The Shadow Monarch",
        deposit: 550,
        daily: 165
    },

    {
        level: 7,
        name: "The Berserk",
        deposit: 1440,
        daily: 432
    }

];


/* ==================================================
   REFERRAL CONFIGURATION
================================================== */

const REFERRAL_PERCENTAGE = 0.05;


/* ==================================================
   HELPERS
================================================== */

function roundUSDT(value) {

    return (
        Math.round(
            Number(value) * 100000000
        ) / 100000000
    );

}


function getCurrentTier(depositedUSDT) {

    const amount =
        Number(depositedUSDT) || 0;


    let current =
        TIERS[0];


    for (
        const tier of TIERS
    ) {

        if (
            amount >=
            Number(tier.deposit)
        ) {

            current =
                tier;

        }

    }


    return current;

}


/* ==================================================
   INDIA 4:30 PM RESET
================================================== */

function getLatestResetBoundary(
    now = new Date()
) {

    const ist =
        new Date(
            now.getTime() +
            INDIA_OFFSET_MINUTES *
            60 *
            1000
        );


    const year =
        ist.getUTCFullYear();


    const month =
        ist.getUTCMonth();


    const day =
        ist.getUTCDate();


    const resetUTC =
        Date.UTC(
            year,
            month,
            day,
            16,
            30,
            0,
            0
        ) -
        INDIA_OFFSET_MINUTES *
        60 *
        1000;


    const reset =
        new Date(
            resetUTC
        );


    if (
        now.getTime() <
        reset.getTime()
    ) {

        return new Date(
            reset.getTime() -
            24 *
            60 *
            60 *
            1000
        );

    }


    return reset;

}


function getNextResetAfter(reset) {

    return new Date(
        new Date(reset).getTime() +
        24 *
        60 *
        60 *
        1000
    );

}


/* ==================================================
   SETTLE DUE DAILY REWARDS
================================================== */

async function settleDueRewardsForUser(
    userId,
    client = null
) {

    const ownClient =
        !client;


    const db =
        client ||
        await pool.connect();


    try {

        if (ownClient) {

            await db.query(
                "BEGIN"
            );

        }


        const walletResult =
            await db.query(
                `
                SELECT
                    id,
                    user_id,
                    balance_usdt,
                    withdrawable_usdt,
                    last_reward_reset_at,
                    created_at,
                    updated_at
                FROM wallets
                WHERE user_id = $1
                FOR UPDATE
                `,
                [
                    userId
                ]
            );


        if (
            walletResult.rows.length === 0
        ) {

            if (ownClient) {

                await db.query(
                    "ROLLBACK"
                );

            }


            return {

                credited: 0,

                cycles: 0,

                tier: TIERS[0],

                withdrawableUSDT: 0

            };

        }


        const wallet =
            walletResult.rows[0];


        const deposited =
            Number(
                wallet.balance_usdt
            ) || 0;


        const currentTier =
            getCurrentTier(
                deposited
            );


        const now =
            new Date();


        const currentReset =
            getLatestResetBoundary(
                now
            );


        let lastReset =
            wallet.last_reward_reset_at
                ? new Date(
                    wallet.last_reward_reset_at
                )
                : new Date(
                    wallet.updated_at ||
                    wallet.created_at ||
                    now
                );


        let nextDue =
            getNextResetAfter(
                lastReset
            );


        let dueCycles = 0;


        while (
            nextDue.getTime() <=
            currentReset.getTime()
        ) {

            dueCycles += 1;


            nextDue =
                getNextResetAfter(
                    nextDue
                );


            if (
                dueCycles >= 3660
            ) {

                break;

            }

        }


        let rewardAmount = 0;


        if (
            dueCycles > 0 &&
            currentTier.daily > 0
        ) {

            rewardAmount =
                roundUSDT(
                    currentTier.daily *
                    dueCycles
                );

        }


        const oldWithdrawable =
            Number(
                wallet.withdrawable_usdt
            ) || 0;


        const newWithdrawable =
            roundUSDT(
                oldWithdrawable +
                rewardAmount
            );


        const updatedWallet =
            await db.query(
                `
                UPDATE wallets
                SET
                    withdrawable_usdt = $1,
                    last_reward_reset_at = $2,
                    updated_at = NOW()
                WHERE id = $3
                RETURNING
                    balance_usdt,
                    withdrawable_usdt,
                    last_reward_reset_at,
                    updated_at
                `,
                [
                    newWithdrawable,
                    currentReset,
                    wallet.id
                ]
            );


        if (
            rewardAmount > 0
        ) {

            let rewardReset =
                getNextResetAfter(
                    lastReset
                );


            for (
                let cycle = 0;
                cycle < dueCycles;
                cycle += 1
            ) {

                const reference =
                    `DAILY-REWARD-${rewardReset
                        .toISOString()
                        .replace(
                            /[-:.TZ]/g,
                            ""
                        )}`;


                await db.query(
                    `
                    INSERT INTO transactions (
                        user_id,
                        type,
                        amount_usdt,
                        status,
                        reference
                    )
                    VALUES (
                        $1,
                        'reward',
                        $2,
                        'completed',
                        $3
                    )
                    `,
                    [
                        userId,
                        currentTier.daily,
                        reference
                    ]
                );


                rewardReset =
                    getNextResetAfter(
                        rewardReset
                    );

            }

        }


        if (ownClient) {

            await db.query(
                "COMMIT"
            );

        }


        return {

            credited:
                rewardAmount,

            cycles:
                dueCycles,

            tier:
                currentTier,

            withdrawableUSDT:
                Number(
                    updatedWallet.rows[0]
                        .withdrawable_usdt
                ),

            lastRewardResetAt:
                updatedWallet.rows[0]
                    .last_reward_reset_at

        };


    } catch (error) {

        if (ownClient) {

            try {

                await db.query(
                    "ROLLBACK"
                );

            } catch (rollbackError) {

                console.error(
                    "Reward rollback error:",
                    rollbackError
                );

            }

        }


        throw error;


    } finally {

        if (ownClient) {

            db.release();

        }

    }

}


/* ==================================================
   SETTLE ALL USERS
================================================== */

async function settleAllDueRewards() {

    const client =
        await pool.connect();


    try {

        const walletsResult =
            await client.query(
                `
                SELECT
                    user_id
                FROM wallets
                ORDER BY user_id
                `
            );


        for (
            const row of
            walletsResult.rows
        ) {

            try {

                await settleDueRewardsForUser(
                    row.user_id
                );

            } catch (userError) {

                console.error(
                    `Daily reward settlement failed for user ${row.user_id}:`,
                    userError
                );

            }

        }


    } catch (error) {

        console.error(
            "Daily reward settlement failed:",
            error
        );


    } finally {

        client.release();

    }

}


/* ==================================================
   GET WALLET
================================================== */

async function getWallet(
    req,
    res
) {

    try {

        const userId =
            req.user.userId;


        await settleDueRewardsForUser(
            userId
        );


        const result =
            await pool.query(
                `
                SELECT
                    id,
                    user_id,
                    balance_usdt,
                    withdrawable_usdt,
                    created_at,
                    updated_at,
                    last_reward_reset_at
                FROM wallets
                WHERE user_id = $1
                LIMIT 1
                `,
                [
                    userId
                ]
            );


        if (
            result.rows.length === 0
        ) {

            return res.status(404).json({

                success: false,

                message:
                    "Wallet not found."

            });

        }


        const wallet =
            result.rows[0];


        const tier =
            getCurrentTier(
                wallet.balance_usdt
            );


        return res.status(200).json({

            success: true,

            wallet: {

                id:
                    wallet.id,

                userId:
                    wallet.user_id,

                balanceUSDT:
                    Number(
                        wallet.balance_usdt
                    ),

                withdrawableUSDT:
                    Number(
                        wallet.withdrawable_usdt
                    ),

                currentTier:
                    tier.name,

                dailyRewardUSDT:
                    Number(
                        tier.daily
                    ),

                createdAt:
                    wallet.created_at,

                updatedAt:
                    wallet.updated_at,

                lastRewardResetAt:
                    wallet.last_reward_reset_at

            }

        });


    } catch (error) {

        console.error(
            "Get wallet error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to load wallet."

        });

    }

}


/* ==================================================
   CREATE DEPOSIT
================================================== */

async function createDeposit(
    req,
    res
) {

    const client = await pool.connect();

    try {

        const userId = req.user.userId;
        const { txHash, network } = req.body;

        const selectedNetwork = String(network || "BEP20")
            .trim()
            .toUpperCase();

        if (
            selectedNetwork !== "BEP20" &&
            selectedNetwork !== "TRC20" &&
            selectedNetwork !== "ERC20" &&
            selectedNetwork !== "POLYGON"
        ) {
            return res.status(400).json({
                success: false,
                message: "Unsupported deposit network."
            });
        }

        if (!txHash || typeof txHash !== "string") {
            return res.status(400).json({
                success: false,
                message: "Transaction hash is required."
            });
        }

        const cleanTxHash = txHash.trim();
        const normalizedTxHash = cleanTxHash.toLowerCase();

        if (!/^(0x)?[a-fA-F0-9]{64}$/.test(cleanTxHash)) {
            return res.status(400).json({
                success: false,
                message: "Invalid transaction hash."
            });
        }

        let verifiedTransfer = null;
        let verifiedAmount = 0;

        /* ------------------------------------------
           BEP20 / BNB SMART CHAIN VERIFICATION
        ------------------------------------------ */

        if (selectedNetwork === "BEP20") {

            const bscTxHash = cleanTxHash.startsWith("0x")
                ? cleanTxHash
                : `0x${cleanTxHash}`;

            if (!BSC_USDT_CONTRACT || !BEP20_DEPOSIT_ADDRESS) {
                throw new Error("BEP20 deposit configuration is missing.");
            }

            const usdtContractAddress =
                ethers.getAddress(BSC_USDT_CONTRACT);

            const depositAddress =
                ethers.getAddress(BEP20_DEPOSIT_ADDRESS);

            const provider = getBscProvider();

            const receipt = await provider.getTransactionReceipt(
                bscTxHash
            );

            if (!receipt) {
                return res.status(400).json({
                    success: false,
                    message: "Transaction was not found yet. Please wait and try again."
                });
            }

            if (receipt.status !== 1) {
                return res.status(400).json({
                    success: false,
                    message: "Blockchain transaction failed."
                });
            }

            for (const log of receipt.logs) {

                if (
                    log.address.toLowerCase() !==
                    usdtContractAddress.toLowerCase()
                ) {
                    continue;
                }

                try {
                    const parsedLog = usdtInterface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });

                    if (!parsedLog || parsedLog.name !== "Transfer") {
                        continue;
                    }

                    const fromAddress = ethers.getAddress(
                        parsedLog.args.from
                    );

                    const toAddress = ethers.getAddress(
                        parsedLog.args.to
                    );

                    if (
                        toAddress.toLowerCase() !==
                        depositAddress.toLowerCase()
                    ) {
                        continue;
                    }

                    verifiedTransfer = {
                        fromAddress,
                        toAddress
                    };

                    verifiedAmount = roundUSDT(
                        Number(
                            ethers.formatUnits(
                                parsedLog.args.value,
                                18
                            )
                        )
                    );

                    break;

                } catch (error) {
                    continue;
                }
            }

            if (!verifiedTransfer) {
                return res.status(400).json({
                    success: false,
                    message: "No valid BEP20 USDT transfer to the AVERYX deposit address was found."
                });
            }
        }

        /* ------------------------------------------
           ERC20 / ETHEREUM VERIFICATION
        ------------------------------------------ */

        if (selectedNetwork === "ERC20") {

            if (!ERC20_USDT_CONTRACT || !ERC20_DEPOSIT_ADDRESS) {
                throw new Error("ERC20 deposit configuration is missing.");
            }

            const ethTxHash = cleanTxHash.startsWith("0x")
                ? cleanTxHash
                : `0x${cleanTxHash}`;

            const usdtContractAddress =
                ethers.getAddress(ERC20_USDT_CONTRACT);

            const depositAddress =
                ethers.getAddress(ERC20_DEPOSIT_ADDRESS);

            const provider = getEthProvider();

            const receipt = await provider.getTransactionReceipt(
                ethTxHash
            );

            if (!receipt) {
                return res.status(400).json({
                    success: false,
                    message: "Transaction was not found yet. Please wait and try again."
                });
            }

            if (receipt.status !== 1) {
                return res.status(400).json({
                    success: false,
                    message: "Blockchain transaction failed."
                });
            }

            for (const log of receipt.logs) {

                if (
                    log.address.toLowerCase() !==
                    usdtContractAddress.toLowerCase()
                ) {
                    continue;
                }

                try {
                    const parsedLog = usdtInterface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });

                    if (!parsedLog || parsedLog.name !== "Transfer") {
                        continue;
                    }

                    const fromAddress = ethers.getAddress(
                        parsedLog.args.from
                    );

                    const toAddress = ethers.getAddress(
                        parsedLog.args.to
                    );

                    if (
                        toAddress.toLowerCase() !==
                        depositAddress.toLowerCase()
                    ) {
                        continue;
                    }

                    /* Ethereum USDT uses 6 decimals. */
                    verifiedAmount = roundUSDT(
                        Number(
                            ethers.formatUnits(
                                parsedLog.args.value,
                                6
                            )
                        )
                    );

                    verifiedTransfer = {
                        fromAddress,
                        toAddress
                    };

                    break;

                } catch (error) {
                    continue;
                }
            }

            if (!verifiedTransfer) {
                return res.status(400).json({
                    success: false,
                    message: "No valid ERC20 USDT transfer to the AVERYX deposit address was found."
                });
            }
        }



        /* ------------------------------------------
           POLYGON POS VERIFICATION
        ------------------------------------------ */

        if (selectedNetwork === "POLYGON") {

            if (!POLYGON_USDT_CONTRACT || !POLYGON_DEPOSIT_ADDRESS) {
                throw new Error("Polygon PoS deposit configuration is missing.");
            }

            const polygonTxHash = cleanTxHash.startsWith("0x")
                ? cleanTxHash
                : `0x${cleanTxHash}`;

            const usdtContractAddress =
                ethers.getAddress(POLYGON_USDT_CONTRACT);

            const depositAddress =
                ethers.getAddress(POLYGON_DEPOSIT_ADDRESS);

            const provider = getPolygonProvider();

            const receipt = await provider.getTransactionReceipt(
                polygonTxHash
            );

            if (!receipt) {
                return res.status(400).json({
                    success: false,
                    message: "Transaction was not found yet. Please wait and try again."
                });
            }

            if (receipt.status !== 1) {
                return res.status(400).json({
                    success: false,
                    message: "Blockchain transaction failed."
                });
            }

            for (const log of receipt.logs) {

                if (
                    log.address.toLowerCase() !==
                    usdtContractAddress.toLowerCase()
                ) {
                    continue;
                }

                try {
                    const parsedLog = usdtInterface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });

                    if (!parsedLog || parsedLog.name !== "Transfer") {
                        continue;
                    }

                    const fromAddress = ethers.getAddress(
                        parsedLog.args.from
                    );

                    const toAddress = ethers.getAddress(
                        parsedLog.args.to
                    );

                    if (
                        toAddress.toLowerCase() !==
                        depositAddress.toLowerCase()
                    ) {
                        continue;
                    }

                    /* Polygon PoS USDT uses 6 decimals. */
                    verifiedAmount = roundUSDT(
                        Number(
                            ethers.formatUnits(
                                parsedLog.args.value,
                                6
                            )
                        )
                    );

                    verifiedTransfer = {
                        fromAddress,
                        toAddress
                    };

                    break;

                } catch (error) {
                    continue;
                }
            }

            if (!verifiedTransfer) {
                return res.status(400).json({
                    success: false,
                    message: "No valid Polygon PoS USDT transfer to the AVERYX deposit address was found."
                });
            }
        }

        /* ------------------------------------------
           TRC20 / TRON VERIFICATION
        ------------------------------------------ */

        if (selectedNetwork === "TRC20") {

            if (!TRC20_USDT_CONTRACT || !TRC20_DEPOSIT_ADDRESS) {
                throw new Error("TRC20 deposit configuration is missing.");
            }

            const tronWeb = getTronWeb();
            const tronTxHash = cleanTxHash.replace(/^0x/i, "");

            console.log("[TRC20] Starting deposit verification:", {
                txHash: tronTxHash,
                usdtContractConfigured: Boolean(TRC20_USDT_CONTRACT),
                depositAddressConfigured: Boolean(TRC20_DEPOSIT_ADDRESS)
            });

            let transaction;
            let transactionInfo;

            try {
                transaction = await tronWeb.trx.getTransaction(tronTxHash);
                transactionInfo = await tronWeb.trx.getTransactionInfo(tronTxHash);
            } catch (tronLookupError) {
                console.error("[TRC20] Transaction lookup error:", tronLookupError);

                return res.status(400).json({
                    success: false,
                    message: "Transaction was not found yet. Please wait and try again."
                });
            }

            if (!transaction || !transaction.txID) {
                console.log("[TRC20] Transaction not found:", tronTxHash);

                return res.status(400).json({
                    success: false,
                    message: "Transaction was not found yet. Please wait and try again."
                });
            }

            console.log("[TRC20] Transaction found:", {
                txID: transaction.txID
            });

            if (!transactionInfo || !transactionInfo.id) {
                console.log("[TRC20] Transaction not confirmed yet:", tronTxHash);

                return res.status(400).json({
                    success: false,
                    message: "Transaction was not confirmed yet. Please wait and try again."
                });
            }

            console.log("[TRC20] Transaction info confirmed:", {
                id: transactionInfo.id,
                logCount: Array.isArray(transactionInfo.log)
                    ? transactionInfo.log.length
                    : 0
            });

            if (
                transactionInfo.receipt &&
                transactionInfo.receipt.result &&
                transactionInfo.receipt.result !== "SUCCESS"
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Blockchain transaction failed."
                });
            }

            const trc20ContractHex =
                tronWeb.address.toHex(TRC20_USDT_CONTRACT)
                    .replace(/^41/i, "")
                    .toLowerCase();

            const depositAddressHex =
                tronWeb.address.toHex(TRC20_DEPOSIT_ADDRESS)
                    .toLowerCase();

            const transferTopic = ethers.id(
                "Transfer(address,address,uint256)"
            ).toLowerCase();

            const logs = transactionInfo.log || [];

            console.log("[TRC20] Verification targets:", {
                usdtContract: trc20ContractHex,
                depositAddress: depositAddressHex,
                logCount: logs.length
            });

            for (const log of logs) {

                const logAddress = String(log.address || "")
                    .replace(/^41/i, "")
                    .toLowerCase();

                if (logAddress !== trc20ContractHex) {
                    continue;
                }

                const topics = log.topics || [];

                if (
                    topics.length < 3 ||
                    String(topics[0]).toLowerCase() !== transferTopic
                ) {
                    continue;
                }

                try {
                    const fromHex = `41${String(topics[1]).slice(-40)}`;
                    const toHex = `41${String(topics[2]).slice(-40)}`;

                    if (
                        toHex.toLowerCase() !==
                        depositAddressHex
                    ) {
                        console.log(
                            "[TRC20] USDT transfer found, but recipient does not match deposit address:",
                            {
                                recipientHex: toHex.toLowerCase()
                            }
                        );

                        continue;
                    }

                    const fromAddress =
                        tronWeb.address.fromHex(fromHex);

                    const toAddress =
                        tronWeb.address.fromHex(toHex);

                    const rawValue = BigInt(
                        `0x${String(log.data || "").replace(/^0x/i, "")}`
                    );

                    /* TRON USDT uses 6 decimals. */
                    verifiedAmount = roundUSDT(
                        Number(rawValue) / 1_000_000
                    );

                    verifiedTransfer = {
                        fromAddress,
                        toAddress
                    };

                    console.log("[TRC20] Valid AVERYX USDT transfer found:", {
                        fromAddress,
                        toAddress,
                        amountUSDT: verifiedAmount
                    });

                    break;

                } catch (error) {
                    continue;
                }
            }

            if (!verifiedTransfer) {
                return res.status(400).json({
                    success: false,
                    message: "No valid TRC20 USDT transfer to the AVERYX deposit address was found."
                });
            }
        }

        if (
            !Number.isFinite(verifiedAmount) ||
            verifiedAmount <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid USDT amount in this transaction."
            });
        }

        const canonicalTxHash =
            selectedNetwork === "BEP20" ||
            selectedNetwork === "ERC20"
                ? (cleanTxHash.startsWith("0x")
                    ? cleanTxHash.toLowerCase()
                    : `0x${cleanTxHash.toLowerCase()}`)
                : tronTxHashForStorage(cleanTxHash);

        await client.query("BEGIN");

        const existingTransaction = await client.query(
            `
            SELECT id
            FROM transactions
            WHERE LOWER(tx_hash) = $1
            LIMIT 1
            `,
            [canonicalTxHash]
        );

        if (existingTransaction.rows.length > 0) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                success: false,
                message: "This transaction hash has already been used."
            });
        }

        const walletResult = await client.query(
            `
            SELECT
                id,
                balance_usdt,
                withdrawable_usdt,
                last_reward_reset_at
            FROM wallets
            WHERE user_id = $1
            FOR UPDATE
            `,
            [userId]
        );

        if (walletResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                success: false,
                message: "Wallet not found."
            });
        }

        const wallet = walletResult.rows[0];
        const oldBalance = Number(wallet.balance_usdt) || 0;
        const newBalance = roundUSDT(oldBalance + verifiedAmount);

        const currentReset = getLatestResetBoundary(new Date());

        let lastRewardReset = wallet.last_reward_reset_at
            ? new Date(wallet.last_reward_reset_at)
            : currentReset;

        if (lastRewardReset.getTime() < currentReset.getTime()) {
            lastRewardReset = currentReset;
        }

        const storedTxHash = canonicalTxHash;

        const transactionResult = await client.query(
            `
            INSERT INTO transactions (
                user_id,
                type,
                amount_usdt,
                status,
                reference,
                tx_hash,
                network,
                from_address,
                to_address
            )
            VALUES (
                $1,
                'deposit',
                $2,
                'completed',
                $3,
                $4,
                $5,
                $6,
                $7
            )
            RETURNING *
            `,
            [
                userId,
                verifiedAmount,
                `${selectedNetwork}-USDT-${storedTxHash}`,
                storedTxHash,
                selectedNetwork,
                verifiedTransfer.fromAddress,
                verifiedTransfer.toAddress
            ]
        );

        const updatedWalletResult = await client.query(
            `
            UPDATE wallets
            SET
                balance_usdt = $1,
                last_reward_reset_at = $2,
                updated_at = NOW()
            WHERE id = $3
            RETURNING
                balance_usdt,
                withdrawable_usdt,
                updated_at
            `,
            [newBalance, lastRewardReset, wallet.id]
        );

        /* ------------------------------------------
           REFERRAL REWARD
        ------------------------------------------ */

        const referralResult = await client.query(
            `
            SELECT referred_by
            FROM users
            WHERE id = $1
            LIMIT 1
            `,
            [userId]
        );

        if (
            referralResult.rows.length > 0 &&
            referralResult.rows[0].referred_by
        ) {
            const referrerId = referralResult.rows[0].referred_by;
            const referralReward = roundUSDT(
                verifiedAmount * REFERRAL_PERCENTAGE
            );

            if (referralReward > 0) {
                const referralReference =
                    `REFERRAL-REWARD-${transactionResult.rows[0].id}`;

                const existingReward = await client.query(
                    `
                    SELECT id
                    FROM transactions
                    WHERE user_id = $1
                    AND type = 'referral'
                    AND reference = $2
                    LIMIT 1
                    `,
                    [referrerId, referralReference]
                );

                if (existingReward.rows.length === 0) {
                    const referrerWalletResult = await client.query(
                        `
                        SELECT id, withdrawable_usdt
                        FROM wallets
                        WHERE user_id = $1
                        FOR UPDATE
                        `,
                        [referrerId]
                    );

                    if (referrerWalletResult.rows.length > 0) {
                        const referrerWallet = referrerWalletResult.rows[0];

                        const newReferrerWithdrawable = roundUSDT(
                            (Number(referrerWallet.withdrawable_usdt) || 0) +
                            referralReward
                        );

                        await client.query(
                            `
                            UPDATE wallets
                            SET
                                withdrawable_usdt = $1,
                                updated_at = NOW()
                            WHERE id = $2
                            `,
                            [newReferrerWithdrawable, referrerWallet.id]
                        );

                        await client.query(
                            `
                            INSERT INTO transactions (
                                user_id,
                                type,
                                amount_usdt,
                                status,
                                reference
                            )
                            VALUES (
                                $1,
                                'referral',
                                $2,
                                'completed',
                                $3
                            )
                            `,
                            [
                                referrerId,
                                referralReward,
                                referralReference
                            ]
                        );
                    }
                }
            }
        }

        await client.query("COMMIT");

        const depositTransaction = transactionResult.rows[0];
        const finalWallet = updatedWalletResult.rows[0];

        return res.status(201).json({
            success: true,
            message: "USDT deposit verified and credited successfully.",
            transaction: {
                id: depositTransaction.id,
                type: depositTransaction.type,
                amountUSDT: Number(depositTransaction.amount_usdt),
                status: depositTransaction.status,
                txHash: depositTransaction.tx_hash,
                network: depositTransaction.network,
                fromAddress: depositTransaction.from_address,
                toAddress: depositTransaction.to_address,
                createdAt: depositTransaction.created_at
            },
            wallet: {
                balanceUSDT: Number(finalWallet.balance_usdt),
                withdrawableUSDT: Number(finalWallet.withdrawable_usdt),
                updatedAt: finalWallet.updated_at
            }
        });

    } catch (error) {

        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            /* Transaction may not have started yet. */
        }

        if (error && error.code === "23505") {
            return res.status(409).json({
                success: false,
                message: "This transaction hash has already been used."
            });
        }

        console.error("Create deposit error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to verify and process deposit."
        });

    } finally {
        client.release();
    }
}

function tronTxHashForStorage(txHash) {
    return txHash.replace(/^0x/i, "").toLowerCase();
}


/* ==================================================
   CREATE WITHDRAWAL
================================================== */

async function createWithdrawal(
    req,
    res
) {

    const userId =
        req.user.userId;


    const {
        amount,
        network,
        address
    } = req.body;


    /*
       Settle any due daily reward first.
    */

    try {

        await settleDueRewardsForUser(
            userId
        );

    } catch (error) {

        console.error(
            "Reward settlement before withdrawal failed:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to update withdrawable balance."

        });

    }


    const client =
        await pool.connect();


    try {

        const numericAmount =
            Number(amount);


        const withdrawalNetworks = {

            BEP20:
                process.env.BEP20_WITHDRAW_ENABLED === "true",

            TRC20:
                process.env.TRC20_WITHDRAW_ENABLED === "true",

            ERC20:
                process.env.ERC20_WITHDRAW_ENABLED === "true",

            POLYGON:
                process.env.POLYGON_WITHDRAW_ENABLED === "true"

        };


        const selectedNetwork =
            String(
                network || ""
            )
            .trim()
            .toUpperCase();


        if (
            !Number.isFinite(
                numericAmount
            ) ||
            numericAmount <= 0
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Please enter a valid withdrawal amount."

            });

        }


        const withdrawalAmount =
            roundUSDT(
                numericAmount
            );


        if (
            withdrawalNetworks[
                selectedNetwork
            ] !== true
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Please select a valid address type."

            });

        }


        if (
            !address ||
            typeof address !== "string" ||
            !address.trim()
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Please enter a wallet address."

            });

        }


        const walletAddress =
            address.trim();


        await client.query(
            "BEGIN"
        );


        const walletResult =
            await client.query(
                `
                SELECT
                    id,
                    balance_usdt,
                    withdrawable_usdt
                FROM wallets
                WHERE user_id = $1
                FOR UPDATE
                `,
                [
                    userId
                ]
            );


        if (
            walletResult.rows.length === 0
        ) {

            await client.query(
                "ROLLBACK"
            );


            return res.status(404).json({

                success: false,

                message:
                    "Wallet not found."

            });

        }


        const wallet =
            walletResult.rows[0];


        const availableWithdrawable =
            Number(
                wallet.withdrawable_usdt
            ) || 0;


        if (
            withdrawalAmount >
            availableWithdrawable
        ) {

            await client.query(
                "ROLLBACK"
            );


            return res.status(400).json({

                success: false,

                message:
                    `Insufficient withdrawable balance. Available: ${roundUSDT(
                        availableWithdrawable
                    )} USDT.`

            });

        }


        const newWithdrawable =
            roundUSDT(
                availableWithdrawable -
                withdrawalAmount
            );


        const shortAddress =
            walletAddress.length > 18
                ? `${walletAddress.slice(
                    0,
                    9
                )}...${walletAddress.slice(
                    -9
                )}`
                : walletAddress;


        const reference =
            `WITHDRAWAL-${selectedNetwork}-${shortAddress}`;


        const transactionResult =
            await client.query(
                `
                INSERT INTO transactions (
                    user_id,
                    type,
                    amount_usdt,
                    status,
                    reference
                )
                VALUES (
                    $1,
                    'withdrawal',
                    $2,
                    'pending',
                    $3
                )
                RETURNING
                    id,
                    type,
                    amount_usdt,
                    status,
                    reference,
                    tx_hash,
                    network,
                    from_address,
                    to_address,
                    created_at
                `,
                [
                    userId,
                    withdrawalAmount,
                    reference
                ]
            );


        const updatedWallet =
            await client.query(
                `
                UPDATE wallets
                SET
                    withdrawable_usdt = $1,
                    updated_at = NOW()
                WHERE id = $2
                RETURNING
                    balance_usdt,
                    withdrawable_usdt,
                    updated_at
                `,
                [
                    newWithdrawable,
                    wallet.id
                ]
            );


        await client.query(
            "COMMIT"
        );


        const transaction =
            transactionResult.rows[0];


        const finalWallet =
            updatedWallet.rows[0];


        return res.status(201).json({

            success: true,

            message:
                "Withdrawal request recorded successfully.",

            transaction: {

                id:
                    transaction.id,

                type:
                    transaction.type,

                amountUSDT:
                    Number(
                        transaction.amount_usdt
                    ),

                status:
                    transaction.status,

                reference:
                    transaction.reference,

                network:
                    selectedNetwork,

                address:
                    walletAddress,

                createdAt:
                    transaction.created_at

            },

            wallet: {

                balanceUSDT:
                    Number(
                        finalWallet.balance_usdt
                    ),

                withdrawableUSDT:
                    Number(
                        finalWallet.withdrawable_usdt
                    ),

                updatedAt:
                    finalWallet.updated_at

            }

        });


    } catch (error) {

        try {

            await client.query(
                "ROLLBACK"
            );

        } catch (rollbackError) {

            console.error(
                "Withdrawal rollback error:",
                rollbackError
            );

        }


        console.error(
            "Create withdrawal error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to process withdrawal."

        });


    } finally {

        client.release();

    }

}


/* ==================================================
   GET TRANSACTION RECORDS
================================================== */

async function getTransactions(
    req,
    res
) {

    try {

        const userId =
            req.user.userId;


        await settleDueRewardsForUser(
            userId
        );


        const result =
            await pool.query(
                `
                SELECT
                    id,
                    type,
                    amount_usdt,
                    status,
                    reference,
                    created_at
                FROM transactions
                WHERE user_id = $1
                ORDER BY created_at DESC
                `,
                [
                    userId
                ]
            );


        const transactions =
            result.rows.map(
                transaction => ({

                    id:
                        transaction.id,

                    type:
                        transaction.type,

                    amountUSDT:
                        Number(
                            transaction.amount_usdt
                        ),

                    status:
                        transaction.status,

                    reference:
                        transaction.reference,

                    txHash:
                        transaction.tx_hash,

                    network:
                        transaction.network,

                    fromAddress:
                        transaction.from_address,

                    toAddress:
                        transaction.to_address,

                    createdAt:
                        transaction.created_at

                })
            );


        return res.status(200).json({

            success: true,

            transactions

        });


    } catch (error) {

        console.error(
            "Get transactions error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to load transaction records."

        });

    }

}


/* ==================================================
   GET REFERRAL STATISTICS
================================================== */

async function getReferralStats(
    req,
    res
) {

    try {

        const userId =
            req.user.userId;


        /* ==================================================
           TOTAL REFERRALS

           Every account whose referred_by points
           to the current user counts.
        ================================================== */

        const totalResult =
            await pool.query(
                `
                SELECT
                    COUNT(*)::int AS total
                FROM users
                WHERE referred_by = $1
                `,
                [
                    userId
                ]
            );


        const totalReferrals =
            Number(
                totalResult.rows[0].total
            ) || 0;


        /* ==================================================
           QUALIFIED REFERRALS

           A referral is qualified when that referred
           account has at least one completed deposit.
        ================================================== */

        const qualifiedResult =
            await pool.query(
                `
                SELECT
                    COUNT(DISTINCT u.id)::int AS qualified
                FROM users u

                INNER JOIN transactions t
                    ON t.user_id = u.id

                WHERE
                    u.referred_by = $1

                    AND t.type = 'deposit'

                    AND t.status = 'completed'

                    AND t.amount_usdt > 0
                `,
                [
                    userId
                ]
            );


        const qualifiedReferrals =
            Number(
                qualifiedResult.rows[0].qualified
            ) || 0;


        /* ==================================================
           TOTAL REFERRAL REWARDS
        ================================================== */

        const rewardResult =
            await pool.query(
                `
                SELECT
                    COALESCE(
                        SUM(amount_usdt),
                        0
                    ) AS total_rewards

                FROM transactions

                WHERE
                    user_id = $1

                    AND type = 'referral'

                    AND status = 'completed'
                `,
                [
                    userId
                ]
            );


        const totalRewardsUSDT =
            roundUSDT(
                Number(
                    rewardResult
                        .rows[0]
                        .total_rewards
                ) || 0
            );


        /* ==================================================
           RECENT REFERRAL ACTIVITY
        ================================================== */

        const activityResult =
            await pool.query(
                `
                SELECT
                    t.id,
                    t.type,
                    t.amount_usdt,
                    t.status,
                    t.reference,
                    t.created_at

                FROM transactions t

                WHERE
                    t.user_id = $1

                    AND t.type = 'referral'

                ORDER BY
                    t.created_at DESC

                LIMIT 20
                `,
                [
                    userId
                ]
            );


        const recentActivity =
            activityResult.rows.map(
                transaction => ({

                    id:
                        transaction.id,

                    type:
                        transaction.type,

                    amountUSDT:
                        Number(
                            transaction.amount_usdt
                        ),

                    status:
                        transaction.status,

                    reference:
                        transaction.reference,

                    createdAt:
                        transaction.created_at

                })
            );


        return res.status(200).json({

            success: true,

            totalReferrals,

            qualifiedReferrals,

            totalRewardsUSDT,

            recentActivity

        });


    } catch (error) {

        console.error(
            "Get referral stats error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to load referral statistics."

        });

    }

}


/* ==================================================
   EXPORT
================================================== */

module.exports = {

    getWallet,

    createDeposit,

    createWithdrawal,

    getTransactions,

    settleDueRewardsForUser,

    settleAllDueRewards,

    getReferralStats

};