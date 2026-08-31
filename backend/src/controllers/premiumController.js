const { pool } = require("../db");

const { ethers } = require("ethers");
const { TronWeb } = require("tronweb");


/* ==================================================
   AVERYX PREMIUM ENVIRONMENT CONFIGURATION
================================================== */

const BSC_RPC_URL =
    process.env.BSC_RPC_URL;

const BSC_USDT_CONTRACT =
    process.env.BSC_USDT_CONTRACT;

const AVERYX_PREMIUM_BEP20_DEPOSIT_ADDRESS =
    process.env.AVERYX_PREMIUM_BEP20_DEPOSIT_ADDRESS;


const TRON_API_URL =
    process.env.TRON_API_URL;

const TRC20_USDT_CONTRACT =
    process.env.TRC20_USDT_CONTRACT;

const AVERYX_PREMIUM_TRC20_DEPOSIT_ADDRESS =
    process.env.AVERYX_PREMIUM_TRC20_DEPOSIT_ADDRESS;


const ETH_RPC_URL =
    process.env.ETH_RPC_URL;

const ERC20_USDT_CONTRACT =
    process.env.ERC20_USDT_CONTRACT;

const AVERYX_PREMIUM_ERC20_DEPOSIT_ADDRESS =
    process.env.AVERYX_PREMIUM_ERC20_DEPOSIT_ADDRESS;


const POLYGON_RPC_URL =
    process.env.POLYGON_RPC_URL;

const POLYGON_USDT_CONTRACT =
    process.env.POLYGON_USDT_CONTRACT;

const AVERYX_PREMIUM_POLYGON_DEPOSIT_ADDRESS =
    process.env.AVERYX_PREMIUM_POLYGON_DEPOSIT_ADDRESS;


/* ==================================================
   USDT TRANSFER EVENT
================================================== */

const usdtInterface =
    new ethers.Interface([
        "event Transfer(address indexed from, address indexed to, uint256 value)"
    ]);


/* ==================================================
   HELPERS
================================================== */

function isEnvTrue(value) {

    return [
        "true",
        "1",
        "yes",
        "on"
    ].includes(
        String(value || "")
            .trim()
            .toLowerCase()
    );

}


function roundUSDT(value) {

    return (
        Math.round(
            Number(value) * 100000000
        ) / 100000000
    );

}


function tronTxHashForStorage(txHash) {

    return String(txHash || "")
        .replace(/^0x/i, "")
        .toLowerCase();

}


/* ==================================================
   PROVIDERS
================================================== */

function getBscProvider() {

    if (!BSC_RPC_URL) {
        throw new Error(
            "BSC_RPC_URL is not configured."
        );
    }

    return new ethers.JsonRpcProvider(
        BSC_RPC_URL
    );

}


function getEthProvider() {

    if (!ETH_RPC_URL) {
        throw new Error(
            "ETH_RPC_URL is not configured."
        );
    }

    return new ethers.JsonRpcProvider(
        ETH_RPC_URL
    );

}


function getPolygonProvider() {

    if (!POLYGON_RPC_URL) {
        throw new Error(
            "POLYGON_RPC_URL is not configured."
        );
    }

    return new ethers.JsonRpcProvider(
        POLYGON_RPC_URL
    );

}


function getTronWeb() {

    if (!TRON_API_URL) {
        throw new Error(
            "TRON_API_URL is not configured."
        );
    }

    return new TronWeb({
        fullHost: TRON_API_URL
    });

}


/* ==================================================
   PREMIUM SYSTEM CONFIGURATION
================================================== */

function getPremiumConfig() {

    return {

        prioritySystemEnabled:
            isEnvTrue(
                process.env
                    .WITHDRAWAL_PRIORITY_SYSTEM_ENABLED
            ),

        premiumEnabled:
            isEnvTrue(
                process.env
                    .AVERYX_PREMIUM_PASS_ENABLED
            ),

        priceUSDT:
            Number(
                process.env
                    .PREMIUM_PASS_PRICE_USDT || 10
            ),

        rewardUSDT:
            Number(
                process.env
                    .PREMIUM_PASS_REWARD_USDT || 40
            ),

        totalPasses:
            Number(
                process.env
                    .PREMIUM_PASS_TOTAL || 20
            )

    };

}


/* ==================================================
   GET PREMIUM PASS STATUS
================================================== */

async function getPremiumStatus(
    req,
    res
) {

    try {

        const userId =
            req.user.userId;


        const config =
            getPremiumConfig();


        const userResult =
            await pool.query(
                `
                SELECT
                    averyx_premium_active,
                    averyx_premium_activated_at
                FROM users
                WHERE id = $1
                LIMIT 1
                `,
                [
                    userId
                ]
            );


        if (
            userResult.rows.length === 0
        ) {

            return res.status(404).json({

                success: false,

                message:
                    "User not found."

            });

        }


        const soldResult =
            await pool.query(
                `
                SELECT
                    COUNT(*)::int AS sold
                FROM
                    averyx_premium_pass_purchases
                WHERE status = 'completed'
                `
            );


        const soldPasses =
            Number(
                soldResult.rows[0].sold
            ) || 0;


        const remainingPasses =
            Math.max(
                0,
                config.totalPasses -
                soldPasses
            );


        const user =
            userResult.rows[0];


        return res.status(200).json({

            success: true,

            premiumSystemEnabled:
                config.prioritySystemEnabled,

            premiumPassEnabled:
                config.prioritySystemEnabled &&
                config.premiumEnabled,

            premium: {

                active:
                    Boolean(
                        user
                            .averyx_premium_active
                    ),

                activatedAt:
                    user
                        .averyx_premium_activated_at

            },

            pass: {

                priceUSDT:
                    config.priceUSDT,

                rewardUSDT:
                    config.rewardUSDT,

                totalPasses:
                    config.totalPasses,

                soldPasses,

                remainingPasses

            }

        });


    } catch (error) {

        console.error(
            "Get AVERYX Premium status error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to load AVERYX Premium status."

        });

    }

}


/* ==================================================
   PURCHASE AVERYX PREMIUM PASS
================================================== */

async function purchasePremiumPass(
    req,
    res
) {

    const client =
        await pool.connect();


    try {

        const userId =
            req.user.userId;


        const {
            txHash,
            network
        } =
            req.body;


        const config =
            getPremiumConfig();


        /*
           Premium system must be enabled
           on the backend.
        */

        if (
            !config.prioritySystemEnabled ||
            !config.premiumEnabled
        ) {

            return res.status(403).json({

                success: false,

                message:
                    "AVERYX Premium Pass is currently unavailable."

            });

        }


        /*
           Validate network.
        */

        const selectedNetwork =
            String(
                network || ""
            )
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

                message:
                    "Unsupported Premium Pass network."

            });

        }


        /*
           Validate transaction hash.
        */

        if (
            !txHash ||
            typeof txHash !== "string"
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Transaction hash is required."

            });

        }


        const cleanTxHash =
            txHash.trim();


        if (
            !/^(0x)?[a-fA-F0-9]{64}$/
                .test(
                    cleanTxHash
                )
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid transaction hash."

            });

        }


        let verifiedTransfer =
            null;


        let verifiedAmount =
            0;


        /* ==============================================
           BEP20 VERIFICATION
        ============================================== */

        if (
            selectedNetwork === "BEP20"
        ) {

            if (
                !BSC_USDT_CONTRACT ||
                !AVERYX_PREMIUM_BEP20_DEPOSIT_ADDRESS
            ) {

                throw new Error(
                    "Premium BEP20 deposit configuration is missing."
                );

            }


            const transactionHash =
                cleanTxHash.startsWith("0x")
                    ? cleanTxHash
                    : `0x${cleanTxHash}`;


            const usdtContractAddress =
                ethers.getAddress(
                    BSC_USDT_CONTRACT
                );


            const depositAddress =
                ethers.getAddress(
                    AVERYX_PREMIUM_BEP20_DEPOSIT_ADDRESS
                );


            const provider =
                getBscProvider();


            const receipt =
                await provider
                    .getTransactionReceipt(
                        transactionHash
                    );


            if (!receipt) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Transaction was not found yet. Please wait and try again."

                });

            }


            if (
                receipt.status !== 1
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Blockchain transaction failed."

                });

            }


            for (
                const log of receipt.logs
            ) {

                if (
                    log.address
                        .toLowerCase() !==
                    usdtContractAddress
                        .toLowerCase()
                ) {

                    continue;

                }


                try {

                    const parsedLog =
                        usdtInterface.parseLog({

                            topics:
                                log.topics,

                            data:
                                log.data

                        });


                    if (
                        !parsedLog ||
                        parsedLog.name !==
                        "Transfer"
                    ) {

                        continue;

                    }


                    const fromAddress =
                        ethers.getAddress(
                            parsedLog.args.from
                        );


                    const toAddress =
                        ethers.getAddress(
                            parsedLog.args.to
                        );


                    if (
                        toAddress
                            .toLowerCase() !==
                        depositAddress
                            .toLowerCase()
                    ) {

                        continue;

                    }


                    verifiedTransfer = {

                        fromAddress,

                        toAddress

                    };


                    verifiedAmount =
                        roundUSDT(
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


            if (
                !verifiedTransfer
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "No valid BEP20 USDT transfer to the AVERYX Premium deposit address was found."

                });

            }

        }


        /* ==============================================
           ERC20 VERIFICATION
        ============================================== */

        if (
            selectedNetwork === "ERC20"
        ) {

            if (
                !ERC20_USDT_CONTRACT ||
                !AVERYX_PREMIUM_ERC20_DEPOSIT_ADDRESS
            ) {

                throw new Error(
                    "Premium ERC20 deposit configuration is missing."
                );

            }


            const transactionHash =
                cleanTxHash.startsWith("0x")
                    ? cleanTxHash
                    : `0x${cleanTxHash}`;


            const usdtContractAddress =
                ethers.getAddress(
                    ERC20_USDT_CONTRACT
                );


            const depositAddress =
                ethers.getAddress(
                    AVERYX_PREMIUM_ERC20_DEPOSIT_ADDRESS
                );


            const provider =
                getEthProvider();


            const receipt =
                await provider
                    .getTransactionReceipt(
                        transactionHash
                    );


            if (!receipt) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Transaction was not found yet. Please wait and try again."

                });

            }


            if (
                receipt.status !== 1
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Blockchain transaction failed."

                });

            }


            for (
                const log of receipt.logs
            ) {

                if (
                    log.address
                        .toLowerCase() !==
                    usdtContractAddress
                        .toLowerCase()
                ) {

                    continue;

                }


                try {

                    const parsedLog =
                        usdtInterface.parseLog({

                            topics:
                                log.topics,

                            data:
                                log.data

                        });


                    if (
                        !parsedLog ||
                        parsedLog.name !==
                        "Transfer"
                    ) {

                        continue;

                    }


                    const fromAddress =
                        ethers.getAddress(
                            parsedLog.args.from
                        );


                    const toAddress =
                        ethers.getAddress(
                            parsedLog.args.to
                        );


                    if (
                        toAddress
                            .toLowerCase() !==
                        depositAddress
                            .toLowerCase()
                    ) {

                        continue;

                    }


                    verifiedTransfer = {

                        fromAddress,

                        toAddress

                    };


                    verifiedAmount =
                        roundUSDT(
                            Number(
                                ethers.formatUnits(
                                    parsedLog.args.value,
                                    6
                                )
                            )
                        );


                    break;


                } catch (error) {

                    continue;

                }

            }


            if (
                !verifiedTransfer
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "No valid ERC20 USDT transfer to the AVERYX Premium deposit address was found."

                });

            }

        }


        /* ==============================================
           POLYGON VERIFICATION
        ============================================== */

        if (
            selectedNetwork === "POLYGON"
        ) {

            if (
                !POLYGON_USDT_CONTRACT ||
                !AVERYX_PREMIUM_POLYGON_DEPOSIT_ADDRESS
            ) {

                throw new Error(
                    "Premium Polygon deposit configuration is missing."
                );

            }


            const transactionHash =
                cleanTxHash.startsWith("0x")
                    ? cleanTxHash
                    : `0x${cleanTxHash}`;


            const usdtContractAddress =
                ethers.getAddress(
                    POLYGON_USDT_CONTRACT
                );


            const depositAddress =
                ethers.getAddress(
                    AVERYX_PREMIUM_POLYGON_DEPOSIT_ADDRESS
                );


            const provider =
                getPolygonProvider();


            const receipt =
                await provider
                    .getTransactionReceipt(
                        transactionHash
                    );


            if (!receipt) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Transaction was not found yet. Please wait and try again."

                });

            }


            if (
                receipt.status !== 1
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Blockchain transaction failed."

                });

            }


            for (
                const log of receipt.logs
            ) {

                if (
                    log.address
                        .toLowerCase() !==
                    usdtContractAddress
                        .toLowerCase()
                ) {

                    continue;

                }


                try {

                    const parsedLog =
                        usdtInterface.parseLog({

                            topics:
                                log.topics,

                            data:
                                log.data

                        });


                    if (
                        !parsedLog ||
                        parsedLog.name !==
                        "Transfer"
                    ) {

                        continue;

                    }


                    const fromAddress =
                        ethers.getAddress(
                            parsedLog.args.from
                        );


                    const toAddress =
                        ethers.getAddress(
                            parsedLog.args.to
                        );


                    if (
                        toAddress
                            .toLowerCase() !==
                        depositAddress
                            .toLowerCase()
                    ) {

                        continue;

                    }


                    verifiedTransfer = {

                        fromAddress,

                        toAddress

                    };


                    verifiedAmount =
                        roundUSDT(
                            Number(
                                ethers.formatUnits(
                                    parsedLog.args.value,
                                    6
                                )
                            )
                        );


                    break;


                } catch (error) {

                    continue;

                }

            }


            if (
                !verifiedTransfer
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "No valid Polygon USDT transfer to the AVERYX Premium deposit address was found."

                });

            }

        }


        /* ==============================================
           TRC20 VERIFICATION
        ============================================== */

        if (
            selectedNetwork === "TRC20"
        ) {

            if (
                !TRC20_USDT_CONTRACT ||
                !AVERYX_PREMIUM_TRC20_DEPOSIT_ADDRESS
            ) {

                throw new Error(
                    "Premium TRC20 deposit configuration is missing."
                );

            }


            const tronWeb =
                getTronWeb();


            const transactionHash =
                cleanTxHash
                    .replace(
                        /^0x/i,
                        ""
                    );


            let transactionInfo;


            try {

                const transaction =
                    await tronWeb.trx
                        .getTransaction(
                            transactionHash
                        );


                transactionInfo =
                    await tronWeb.trx
                        .getTransactionInfo(
                            transactionHash
                        );


                if (
                    !transaction ||
                    !transaction.txID
                ) {

                    return res.status(400).json({

                        success: false,

                        message:
                            "Transaction was not found yet. Please wait and try again."

                    });

                }


            } catch (error) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Transaction was not found yet. Please wait and try again."

                });

            }


            if (
                !transactionInfo ||
                !transactionInfo.id
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Transaction was not confirmed yet. Please wait and try again."

                });

            }


            if (
                transactionInfo.receipt &&
                transactionInfo.receipt.result &&
                transactionInfo.receipt.result !==
                "SUCCESS"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Blockchain transaction failed."

                });

            }


            const trc20ContractHex =
                tronWeb.address
                    .toHex(
                        TRC20_USDT_CONTRACT
                    )
                    .replace(
                        /^41/i,
                        ""
                    )
                    .toLowerCase();


            const depositAddressHex =
                tronWeb.address
                    .toHex(
                        AVERYX_PREMIUM_TRC20_DEPOSIT_ADDRESS
                    )
                    .toLowerCase();


            const transferTopic =
                ethers.id(
                    "Transfer(address,address,uint256)"
                )
                .toLowerCase();


            const logs =
                transactionInfo.log || [];


            for (
                const log of logs
            ) {

                const logAddress =
                    String(
                        log.address || ""
                    )
                    .replace(
                        /^41/i,
                        ""
                    )
                    .toLowerCase();


                if (
                    logAddress !==
                    trc20ContractHex
                ) {

                    continue;

                }


                const topics =
                    log.topics || [];


                if (
                    topics.length < 3 ||
                    String(
                        topics[0]
                    ).toLowerCase() !==
                    transferTopic
                ) {

                    continue;

                }


                try {

                    const fromHex =
                        `41${String(
                            topics[1]
                        ).slice(-40)}`;


                    const toHex =
                        `41${String(
                            topics[2]
                        ).slice(-40)}`;


                    if (
                        toHex.toLowerCase() !==
                        depositAddressHex
                    ) {

                        continue;

                    }


                    const fromAddress =
                        tronWeb.address
                            .fromHex(
                                fromHex
                            );


                    const toAddress =
                        tronWeb.address
                            .fromHex(
                                toHex
                            );


                    const rawValue =
                        BigInt(
                            `0x${String(
                                log.data || ""
                            ).replace(
                                /^0x/i,
                                ""
                            )}`
                        );


                    verifiedAmount =
                        roundUSDT(
                            Number(
                                rawValue
                            ) / 1_000_000
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


            if (
                !verifiedTransfer
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "No valid TRC20 USDT transfer to the AVERYX Premium deposit address was found."

                });

            }

        }


        /* ==============================================
           AMOUNT VALIDATION
        ============================================== */

        if (
            !Number.isFinite(
                verifiedAmount
            ) ||
            verifiedAmount <= 0
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid USDT amount in this transaction."

            });

        }


        /*
           Premium Pass requires the exact
           configured payment amount.
        */

        if (
            verifiedAmount !==
            config.priceUSDT
        ) {

            return res.status(400).json({

                success: false,

                message:
                    `Premium Pass requires exactly ${config.priceUSDT} USDT.`,

                expectedAmount:
                    config.priceUSDT,

                receivedAmount:
                    verifiedAmount

            });

        }


        /* ==============================================
           CANONICAL TX HASH
        ============================================== */

        const canonicalTxHash =
            selectedNetwork === "TRC20"
                ? tronTxHashForStorage(
                    cleanTxHash
                )
                : (
                    cleanTxHash
                        .startsWith("0x")
                        ? cleanTxHash
                            .toLowerCase()
                        : `0x${cleanTxHash
                            .toLowerCase()}`
                );


        /* ==============================================
           DATABASE TRANSACTION
        ============================================== */

        await client.query(
            "BEGIN"
        );


        /*
           Lock the Premium purchase table
           so simultaneous purchases cannot
           exceed the configured inventory.
        */

        await client.query(
            `
            LOCK TABLE
            averyx_premium_pass_purchases
            IN SHARE ROW EXCLUSIVE MODE
            `
        );


        /* ------------------------------------------
           CHECK DUPLICATE TX HASH
        ------------------------------------------ */

        const existingPurchase =
            await client.query(
                `
                SELECT id
                FROM
                    averyx_premium_pass_purchases
                WHERE LOWER(tx_hash) = $1
                LIMIT 1
                `,
                [
                    canonicalTxHash
                        .toLowerCase()
                ]
            );


        if (
            existingPurchase.rows.length > 0
        ) {

            await client.query(
                "ROLLBACK"
            );


            return res.status(409).json({

                success: false,

                message:
                    "This Premium Pass transaction hash has already been used."

            });

        }


        /*
           Also prevent the same blockchain
           payment from having been used in
           the existing deposit system.
        */

        const existingMainTransaction =
            await client.query(
                `
                SELECT id
                FROM transactions
                WHERE LOWER(tx_hash) = $1
                LIMIT 1
                `,
                [
                    canonicalTxHash
                        .toLowerCase()
                ]
            );


        if (
            existingMainTransaction.rows.length > 0
        ) {

            await client.query(
                "ROLLBACK"
            );


            return res.status(409).json({

                success: false,

                message:
                    "This transaction hash has already been used in another AVERYX payment system."

            });

        }


        /* ------------------------------------------
           CHECK USER PREMIUM STATUS
        ------------------------------------------ */

        const userResult =
            await client.query(
                `
                SELECT
                    id,
                    averyx_premium_active
                FROM users
                WHERE id = $1
                FOR UPDATE
                `,
                [
                    userId
                ]
            );


        if (
            userResult.rows.length === 0
        ) {

            await client.query(
                "ROLLBACK"
            );


            return res.status(404).json({

                success: false,

                message:
                    "User not found."

            });

        }


        if (
            userResult.rows[0]
                .averyx_premium_active
        ) {

            await client.query(
                "ROLLBACK"
            );


            return res.status(409).json({

                success: false,

                message:
                    "AVERYX Premium is already active for this account."

            });

        }


        /* ------------------------------------------
           CHECK PASS INVENTORY
        ------------------------------------------ */

        const inventoryResult =
            await client.query(
                `
                SELECT
                    COUNT(*)::int AS sold
                FROM
                    averyx_premium_pass_purchases
                WHERE status = 'completed'
                `
            );


        const soldPasses =
            Number(
                inventoryResult.rows[0]
                    .sold
            ) || 0;


        if (
            soldPasses >=
            config.totalPasses
        ) {

            await client.query(
                "ROLLBACK"
            );


            return res.status(409).json({

                success: false,

                message:
                    "All AVERYX Premium Passes have been sold."

            });

        }


        /* ------------------------------------------
           CREATE PREMIUM PURCHASE RECORD
        ------------------------------------------ */

        const purchaseResult =
            await client.query(
                `
                INSERT INTO
                    averyx_premium_pass_purchases (
                        user_id,
                        tx_hash,
                        network,
                        amount_usdt,
                        from_address,
                        to_address,
                        status,
                        activated_at
                    )
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    'completed',
                    NOW()
                )
                RETURNING *
                `,
                [
                    userId,

                    canonicalTxHash,

                    selectedNetwork,

                    verifiedAmount,

                    verifiedTransfer
                        .fromAddress,

                    verifiedTransfer
                        .toAddress
                ]
            );


        /* ------------------------------------------
           ACTIVATE AVERYX PREMIUM
        ------------------------------------------ */

        const activatedUserResult =
            await client.query(
                `
                UPDATE users
                SET
                    averyx_premium_active = TRUE,
                    averyx_premium_activated_at = NOW()
                WHERE id = $1
                RETURNING
                    averyx_premium_active,
                    averyx_premium_activated_at
                `,
                [
                    userId
                ]
            );


        await client.query(
            "COMMIT"
        );


        const purchase =
            purchaseResult.rows[0];


        const activatedUser =
            activatedUserResult.rows[0];


        return res.status(201).json({

            success: true,

            message:
                "AVERYX Premium Pass activated successfully.",

            premium: {

                active:
                    Boolean(
                        activatedUser
                            .averyx_premium_active
                    ),

                activatedAt:
                    activatedUser
                        .averyx_premium_activated_at

            },

            purchase: {

                id:
                    purchase.id,

                amountUSDT:
                    Number(
                        purchase
                            .amount_usdt
                    ),

                network:
                    purchase.network,

                txHash:
                    purchase.tx_hash,

                fromAddress:
                    purchase.from_address,

                toAddress:
                    purchase.to_address,

                status:
                    purchase.status,

                createdAt:
                    purchase.created_at

            },

            pass: {

                rewardUSDT:
                    config.rewardUSDT,

                remainingPasses:
                    Math.max(
                        0,
                        config.totalPasses -
                        soldPasses -
                        1
                    )

            }

        });


    } catch (error) {

        try {

            await client.query(
                "ROLLBACK"
            );

        } catch (rollbackError) {

            /*
               Transaction may not have started.
            */

        }


        if (
            error &&
            error.code === "23505"
        ) {

            return res.status(409).json({

                success: false,

                message:
                    "This Premium Pass transaction hash has already been used."

            });

        }


        console.error(
            "Purchase AVERYX Premium Pass error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to verify and activate AVERYX Premium Pass."

        });


    } finally {

        client.release();

    }

}


/* ==================================================
   EXPORT
================================================== */

module.exports = {

    getPremiumStatus,

    purchasePremiumPass

};