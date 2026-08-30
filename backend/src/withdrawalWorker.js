const { pool } = require("./db");
const { ethers } = require("ethers");
const {
    getNetworkConfig,
    getProvider
} = require("./services/gasQuoteService");
const {
    ensureGasForWithdrawal
} = require("./services/gasFundingService");

/* ==================================================
   LIVE WITHDRAWAL WORKER

   SAFETY MODEL

   1. Only complete, quote-backed withdrawals are claimed.
   2. The amount sent is the STORED recipient_amount_usdt.
      The worker never recalculates the user's quote.
   3. Invalid legacy pending rows are not claimed.
   4. A broadcast transaction is NEVER auto-refunded.
   5. tx_hash is persisted immediately after broadcast.
   6. Processing is protected with SKIP LOCKED.
================================================== */

const WORKER_ENABLED =
    String(process.env.WITHDRAWAL_WORKER_ENABLED).toLowerCase() === "true";

const DRY_RUN =
    String(process.env.WITHDRAWAL_WORKER_DRY_RUN ?? "true")
        .toLowerCase() !== "false";

const TEST_MODE =
    String(process.env.WITHDRAWAL_WORKER_TEST_MODE ?? "false")
        .toLowerCase() === "true";

const TEST_WITHDRAWAL_ID =
    String(process.env.WITHDRAWAL_WORKER_TEST_ID ?? "").trim();

const EVM_NETWORKS = new Set([
    "BEP20",
    "ERC20",
    "POLYGON"
]);

const ERC20_ABI = [
    "function decimals() view returns (uint8)",
    "function balanceOf(address owner) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)"
];

const MAX_CONFIRMATION_WAIT_MS =
    Number(process.env.WITHDRAWAL_CONFIRMATION_WAIT_MS || 60000);

const TRON_CONFIRMATION_POLL_MS = 2500;


/* ==================================================
   ENVIRONMENT HELPERS
================================================== */

function getFirstConfiguredEnv(names) {
    for (const name of names) {
        const value = String(process.env[name] || "").trim();

        if (value) {
            return value;
        }
    }

    return "";
}

function getEvmPrivateKey(network) {
    const normalized = String(network || "").toUpperCase();

    const privateKey = getFirstConfiguredEnv([
        `${normalized}_WITHDRAW_PRIVATE_KEY`,
        `${normalized}_PRIVATE_KEY`,
        "EVM_WITHDRAW_PRIVATE_KEY",
        "WITHDRAW_PRIVATE_KEY"
    ]);

    if (!privateKey) {
        throw new Error(
            `${normalized} withdrawal private key is not configured.`
        );
    }

    return privateKey.startsWith("0x")
        ? privateKey
        : `0x${privateKey}`;
}

function getTronPrivateKey() {
    const privateKey = getFirstConfiguredEnv([
        "TRC20_WITHDRAW_PRIVATE_KEY",
        "TRON_WITHDRAW_PRIVATE_KEY"
    ]);

    if (!privateKey) {
        throw new Error(
            "TRC20 withdrawal private key is not configured."
        );
    }

    return privateKey.replace(/^0x/i, "");
}

function getTronApiUrl() {
    return String(
        process.env.TRON_API_URL || "https://api.trongrid.io"
    ).trim();
}

function getTronWithdrawAddress() {
    return String(
        process.env.TRC20_WITHDRAW_ADDRESS || ""
    ).trim();
}

function getTronUsdtContract() {
    return String(
        process.env.TRC20_USDT_CONTRACT || ""
    ).trim();
}

function normalizeNetwork(network) {
    return String(network || "")
        .trim()
        .toUpperCase();
}

function assertPositiveAmount(value, label) {
    const amount = Number(value);

    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`${label} must be greater than zero.`);
    }

    return amount;
}

function createBroadcastError(message, txHash, cause) {
    const error = new Error(message);

    error.broadcasted = true;
    error.txHash = txHash || null;
    error.cause = cause || null;

    return error;
}


/* ==================================================
   GET PENDING WITHDRAWALS
================================================== */

async function getPendingWithdrawals() {
    const result = await pool.query(
        `
        SELECT
            id,
            user_id,
            type,
            amount_usdt,
            recipient_amount_usdt,
            gas_cost_usdt,
            margin_usdt,
            status,
            reference,
            tx_hash,
            network,
            from_address,
            to_address,
            created_at
        FROM transactions
        WHERE
            type = 'withdrawal'
            AND LOWER(status) = 'pending'
            AND tx_hash IS NULL
            AND network IS NOT NULL
            AND UPPER(network) IN ('BEP20', 'ERC20', 'POLYGON')
            AND to_address IS NOT NULL
            AND BTRIM(to_address) <> ''
            AND recipient_amount_usdt IS NOT NULL
            AND recipient_amount_usdt > 0
        ORDER BY created_at ASC
        LIMIT 10
        `
    );

    return result.rows;
}


/* ==================================================
   CLAIM ONE WITHDRAWAL
================================================== */

async function claimNextPendingWithdrawal(targetWithdrawalId = null) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const result = await client.query(
            `
            WITH next_withdrawal AS (
                SELECT id
                FROM transactions
                WHERE
                    type = 'withdrawal'
                    AND LOWER(status) = 'pending'
                    AND tx_hash IS NULL
                    AND network IS NOT NULL
                    AND UPPER(network) IN ('BEP20', 'ERC20', 'POLYGON')
                    AND to_address IS NOT NULL
                    AND BTRIM(to_address) <> ''
                    AND recipient_amount_usdt IS NOT NULL
                    AND recipient_amount_usdt > 0
                    AND (
                        $1::bigint IS NULL
                        OR id = $1::bigint
                    )
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            UPDATE transactions
            SET status = 'processing'
            WHERE id IN (
                SELECT id FROM next_withdrawal
            )
            RETURNING
                id,
                user_id,
                type,
                amount_usdt,
                recipient_amount_usdt,
                gas_cost_usdt,
                margin_usdt,
                status,
                reference,
                tx_hash,
                network,
                from_address,
                to_address,
                created_at
            `,
            [targetWithdrawalId]
        );

        await client.query("COMMIT");

        return result.rows[0] || null;
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (_) {
        }

        throw error;
    } finally {
        client.release();
    }
}


/* ==================================================
   PERSIST BROADCAST

   The transaction hash is written before any
   confirmation wait. Once this succeeds, the worker
   must never auto-refund this withdrawal.
================================================== */

async function persistBroadcast({
    withdrawalId,
    txHash,
    fromAddress
}) {
    const result = await pool.query(
        `
        UPDATE transactions
        SET
            status = 'broadcasted',
            tx_hash = $2,
            from_address = $3
        WHERE
            id = $1
            AND type = 'withdrawal'
            AND LOWER(status) = 'processing'
            AND tx_hash IS NULL
        RETURNING
            id,
            status,
            tx_hash,
            from_address
        `,
        [withdrawalId, txHash, fromAddress]
    );

    if (result.rows.length === 0) {
        throw createBroadcastError(
            "Blockchain transaction was broadcast, but the database could not safely record its broadcast state. Manual reconciliation is required.",
            txHash
        );
    }

    return result.rows[0];
}


/* ==================================================
   MARK COMPLETED
================================================== */

async function markWithdrawalCompleted(withdrawalId, txHash) {
    const result = await pool.query(
        `
        UPDATE transactions
        SET status = 'completed'
        WHERE
            id = $1
            AND type = 'withdrawal'
            AND tx_hash = $2
            AND LOWER(status) IN ('broadcasted', 'processing')
        RETURNING id, status, tx_hash
        `,
        [withdrawalId, txHash]
    );

    return result.rows[0] || null;
}


/* ==================================================
   FAIL BEFORE BROADCAST AND RESTORE FUNDS
================================================== */

async function failWithdrawalBeforeBroadcast(withdrawalId, reason) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const withdrawalResult = await client.query(
            `
            SELECT
                id,
                user_id,
                amount_usdt,
                status,
                tx_hash
            FROM transactions
            WHERE
                id = $1
                AND type = 'withdrawal'
            FOR UPDATE
            `,
            [withdrawalId]
        );

        if (withdrawalResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return {
                success: false,
                reason: "Withdrawal record not found."
            };
        }

        const withdrawal = withdrawalResult.rows[0];

        if (withdrawal.tx_hash) {
            await client.query("COMMIT");

            return {
                success: false,
                reason:
                    "Transaction was already broadcast. Automatic refund blocked."
            };
        }

        if (String(withdrawal.status).toLowerCase() !== "processing") {
            await client.query("COMMIT");

            return {
                success: false,
                reason:
                    "Withdrawal is not currently processing."
            };
        }

        const walletResult = await client.query(
            `
            SELECT id, withdrawable_usdt
            FROM wallets
            WHERE user_id = $1
            FOR UPDATE
            `,
            [withdrawal.user_id]
        );

        if (walletResult.rows.length === 0) {
            throw new Error(
                "User wallet not found during withdrawal recovery."
            );
        }

        await client.query(
            `
            UPDATE wallets
            SET
                withdrawable_usdt = withdrawable_usdt + $1,
                updated_at = NOW()
            WHERE user_id = $2
            `,
            [withdrawal.amount_usdt, withdrawal.user_id]
        );

        await client.query(
            `
            UPDATE transactions
            SET status = 'failed'
            WHERE
                id = $1
                AND tx_hash IS NULL
                AND LOWER(status) = 'processing'
            `,
            [withdrawal.id]
        );

        await client.query("COMMIT");

        console.log(
            "[Withdrawal Worker] Withdrawal failed before broadcast and funds restored:",
            {
                id: withdrawal.id,
                user_id: withdrawal.user_id,
                amount: withdrawal.amount_usdt,
                reason
            }
        );

        return {
            success: true,
            withdrawalId: withdrawal.id,
            restoredAmount: withdrawal.amount_usdt
        };
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (_) {
        }

        throw error;
    } finally {
        client.release();
    }
}


/* ==================================================
   EVM SENDER

   Used for BEP20, ERC20 and POLYGON.
================================================== */

async function sendEvmUsdtWithdrawal(withdrawal) {
    const network = normalizeNetwork(withdrawal.network);
    const config = getNetworkConfig(network);
    const provider = getProvider(network);

    if (!ethers.isAddress(withdrawal.to_address)) {
        throw new Error(`${network} recipient address is invalid.`);
    }

    const privateKey = getEvmPrivateKey(network);
    const signer = new ethers.Wallet(privateKey, provider);
    const senderAddress = await signer.getAddress();

    if (
        config.withdrawAddress &&
        ethers.getAddress(config.withdrawAddress) !==
        ethers.getAddress(senderAddress)
    ) {
        throw new Error(
            `${network} withdrawal private key does not match ${network} withdrawal address.`
        );
    }

    const contract = new ethers.Contract(
        config.usdtContract,
        ERC20_ABI,
        signer
    );

    const decimals = Number(await contract.decimals());
    const recipientAmount = assertPositiveAmount(
        withdrawal.recipient_amount_usdt,
        "Recipient amount"
    );

    const amountUnits = ethers.parseUnits(
        String(withdrawal.recipient_amount_usdt),
        decimals
    );

    const usdtBalance = await contract.balanceOf(senderAddress);

    if (usdtBalance < amountUnits) {
        throw new Error(
            `${network} withdrawal wallet has insufficient USDT balance.`
        );
    }

    const estimatedGas = await contract.transfer.estimateGas(
        withdrawal.to_address,
        amountUnits
    );

    /* 20% safety buffer, rounded up. */
    const gasLimit =
        (estimatedGas * 120n + 99n) / 100n;

    const feeData = await provider.getFeeData();
    const overrides = { gasLimit };

    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        overrides.maxFeePerGas = feeData.maxFeePerGas;
        overrides.maxPriorityFeePerGas =
            feeData.maxPriorityFeePerGas;
    } else if (feeData.gasPrice) {
        overrides.gasPrice = feeData.gasPrice;
    } else {
        throw new Error(
            `${network} gas price is unavailable.`
        );
    }

    const nativeBalance = await provider.getBalance(senderAddress);

    const maxGasPrice =
        overrides.maxFeePerGas ||
        overrides.gasPrice;

    const requiredNative =
        gasLimit * maxGasPrice;

    if (nativeBalance < requiredNative) {
        console.log(
            `[Withdrawal Worker] ${network} native gas is insufficient. Starting automatic gas funding.`
        );

        const gasFundingResult =
            await ensureGasForWithdrawal({
                network,
                withdrawalWalletAddress: senderAddress,
                requiredGasWei: requiredNative
            });

        console.log(
            `[Withdrawal Worker] ${network} gas funding result:`,
            {
                fundingRequired: gasFundingResult.fundingRequired,
                funded: gasFundingResult.funded,
                amountFunded: gasFundingResult.amountFunded,
                fundingTxHash: gasFundingResult.fundingTxHash
            }
        );

        /*
           The funding transaction is confirmed inside
           ensureGasForWithdrawal(). Re-check the balance
           immediately before broadcasting the USDT transfer.
        */
        const nativeBalanceAfterFunding =
            await provider.getBalance(senderAddress);

        if (nativeBalanceAfterFunding < requiredNative) {
            throw new Error(
                `${network} withdrawal wallet still has insufficient native token for gas after automatic funding.`
            );
        }
    }

    let tx;

    try {
        tx = await contract.transfer(
            withdrawal.to_address,
            amountUnits,
            overrides
        );
    } catch (error) {
        throw error;
    }

    const txHash = tx.hash;

    try {
        await persistBroadcast({
            withdrawalId: withdrawal.id,
            txHash,
            fromAddress: senderAddress
        });
    } catch (error) {
        if (!error.broadcasted) {
            throw createBroadcastError(
                error.message ||
                    "Transaction broadcast succeeded but broadcast persistence failed.",
                txHash,
                error
            );
        }

        throw error;
    }

    try {
        const receipt = await tx.wait(1, MAX_CONFIRMATION_WAIT_MS);

        if (!receipt) {
            return {
                success: false,
                broadcasted: true,
                txHash,
                reason:
                    "Transaction broadcast successfully and is awaiting confirmation."
            };
        }

        if (Number(receipt.status) !== 1) {
            return {
                success: false,
                broadcasted: true,
                txHash,
                reason:
                    "Transaction was broadcast but did not complete successfully. Manual reconciliation is required."
            };
        }

        await markWithdrawalCompleted(withdrawal.id, txHash);

        return {
            success: true,
            broadcasted: true,
            completed: true,
            txHash,
            fromAddress: senderAddress
        };
    } catch (error) {
        return {
            success: false,
            broadcasted: true,
            txHash,
            reason:
                "Transaction broadcast successfully but confirmation is pending: " +
                error.message
        };
    }
}


/* ==================================================
   TRC20 SENDER (LEGACY / NOT USED BY WORKER)
================================================== */

function getTronWebConstructor() {
    let moduleValue;

    try {
        moduleValue = require("tronweb");
    } catch (_) {
        throw new Error(
            "TRC20 withdrawals require the tronweb package. Install it with: npm install tronweb"
        );
    }

    return (
        moduleValue.TronWeb ||
        moduleValue.default ||
        moduleValue
    );
}

async function waitForTronConfirmation(tronWeb, txHash) {
    const deadline = Date.now() + MAX_CONFIRMATION_WAIT_MS;

    while (Date.now() < deadline) {
        const info = await tronWeb.trx.getTransactionInfo(txHash);

        if (info && Object.keys(info).length > 0) {
            const result =
                info.receipt &&
                info.receipt.result;

            if (result && result !== "SUCCESS") {
                return {
                    confirmed: true,
                    success: false,
                    info
                };
            }

            return {
                confirmed: true,
                success: true,
                info
            };
        }

        await new Promise(resolve =>
            setTimeout(resolve, TRON_CONFIRMATION_POLL_MS)
        );
    }

    return {
        confirmed: false,
        success: false
    };
}

async function sendTrc20UsdtWithdrawal(withdrawal) {
    const TronWeb = getTronWebConstructor();

    const fullHost = getTronApiUrl();
    const privateKey = getTronPrivateKey();
    const configuredAddress = getTronWithdrawAddress();
    const contractAddress = getTronUsdtContract();

    if (!configuredAddress) {
        throw new Error(
            "TRC20 withdrawal wallet address is not configured."
        );
    }

    if (!contractAddress) {
        throw new Error(
            "TRC20 USDT contract is not configured."
        );
    }

    let tronWeb;

    try {
        tronWeb = new TronWeb({
            fullHost,
            privateKey
        });
    } catch (_) {
        /* Compatibility with older TronWeb versions. */
        tronWeb = new TronWeb(fullHost, undefined, undefined, privateKey);
    }

    if (!tronWeb.isAddress(withdrawal.to_address)) {
        throw new Error("TRC20 recipient address is invalid.");
    }

    if (!tronWeb.isAddress(configuredAddress)) {
        throw new Error("TRC20 withdrawal wallet address is invalid.");
    }

    if (!tronWeb.isAddress(contractAddress)) {
        throw new Error("TRC20 USDT contract address is invalid.");
    }

    const senderAddress = tronWeb.defaultAddress.base58;

    if (
        senderAddress &&
        senderAddress !== configuredAddress
    ) {
        throw new Error(
            "TRC20 withdrawal private key does not match TRC20 withdrawal address."
        );
    }

    const contract = await tronWeb.contract().at(contractAddress);
    const decimalsRaw = await contract.decimals().call();
    const decimals = Number(decimalsRaw.toString());

    const amountUnits = ethers.parseUnits(
        String(withdrawal.recipient_amount_usdt),
        decimals
    );

    const balanceRaw = await contract.balanceOf(configuredAddress).call();
    const balance = BigInt(balanceRaw.toString());

    if (balance < amountUnits) {
        throw new Error(
            "TRC20 withdrawal wallet has insufficient USDT balance."
        );
    }

    const feeLimitSun = Number(
        process.env.TRC20_WITHDRAW_FEE_LIMIT_SUN ||
        100000000
    );

    const txHash = await contract
        .transfer(
            withdrawal.to_address,
            amountUnits.toString()
        )
        .send({
            feeLimit: feeLimitSun,
            shouldPollResponse: false
        });

    if (!txHash) {
        throw new Error(
            "TRC20 transfer did not return a transaction hash."
        );
    }

    await persistBroadcast({
        withdrawalId: withdrawal.id,
        txHash,
        fromAddress: configuredAddress
    });

    try {
        const confirmation = await waitForTronConfirmation(
            tronWeb,
            txHash
        );

        if (confirmation.confirmed && confirmation.success) {
            await markWithdrawalCompleted(withdrawal.id, txHash);

            return {
                success: true,
                broadcasted: true,
                completed: true,
                txHash,
                fromAddress: configuredAddress
            };
        }

        return {
            success: false,
            broadcasted: true,
            txHash,
            reason:
                confirmation.confirmed
                    ? "TRC20 transaction was broadcast but did not complete successfully. Manual reconciliation is required."
                    : "TRC20 transaction broadcast successfully and is awaiting confirmation."
        };
    } catch (error) {
        return {
            success: false,
            broadcasted: true,
            txHash,
            reason:
                "TRC20 transaction broadcast successfully but confirmation is pending: " +
                error.message
        };
    }
}


/* ==================================================
   PROCESS ONE WITHDRAWAL
================================================== */

async function processWithdrawal(withdrawal) {
    const network = normalizeNetwork(withdrawal.network);

    console.log(
        "[Withdrawal Worker] Processing withdrawal:",
        {
            id: withdrawal.id,
            network,
            requestedAmount: withdrawal.amount_usdt,
            recipientAmount: withdrawal.recipient_amount_usdt,
            recipient: withdrawal.to_address
        }
    );

    if (!network) {
        throw new Error("Withdrawal network is missing.");
    }

    if (!withdrawal.to_address) {
        throw new Error("Withdrawal recipient address is missing.");
    }

    assertPositiveAmount(
        withdrawal.recipient_amount_usdt,
        "Recipient amount"
    );

    if (EVM_NETWORKS.has(network)) {
        return sendEvmUsdtWithdrawal(withdrawal);
    }

    if (network === "TRC20") {
        /*
           TRC20 is intentionally manual.

           The withdrawal worker must never broadcast a TRC20 transaction.
           TRC20 requests remain in the database with status = pending until
           an administrator manually sends the transfer and records the tx hash.
        */
        return {
            success: false,
            manual: true,
            keepPending: true,
            reason: "TRC20 withdrawals are processed manually and must remain pending."
        };
    }

    throw new Error(`Unsupported withdrawal network: ${network}`);
}


/* ==================================================
   RUN WITHDRAWAL WORKER
================================================== */

async function runWithdrawalWorker() {
    if (!WORKER_ENABLED) {
        return;
    }

    try {
        if (DRY_RUN) {
            const pendingWithdrawals = await getPendingWithdrawals();

            if (pendingWithdrawals.length > 0) {
                console.log(
                    `[Withdrawal Worker] ${pendingWithdrawals.length} valid pending withdrawal(s) found.`
                );
            }

            return;
        }

        let targetWithdrawalId = null;

        if (TEST_MODE) {
            if (!/^\d+$/.test(TEST_WITHDRAWAL_ID)) {
                console.error(
                    "[Withdrawal Worker] TEST MODE is enabled, but WITHDRAWAL_WORKER_TEST_ID is missing or invalid."
                );

                return;
            }

            targetWithdrawalId = TEST_WITHDRAWAL_ID;

            console.log(
                "[Withdrawal Worker] TEST MODE active. Only withdrawal ID " +
                targetWithdrawalId +
                " can be processed."
            );
        }

        const withdrawal = await claimNextPendingWithdrawal(
            targetWithdrawalId
        );

        if (!withdrawal) {
            if (TEST_MODE) {
                console.log(
                    "[Withdrawal Worker] Test withdrawal ID " +
                    targetWithdrawalId +
                    " is not a valid pending withdrawal."
                );
            }

            return;
        }

        try {
            const result = await processWithdrawal(withdrawal);

            if (result && result.success === true) {
                console.log(
                    "[Withdrawal Worker] Withdrawal completed:",
                    {
                        id: withdrawal.id,
                        txHash: result.txHash
                    }
                );

                return;
            }

            if (result && result.broadcasted === true) {
                console.log(
                    "[Withdrawal Worker] Withdrawal broadcasted and awaiting reconciliation/confirmation:",
                    {
                        id: withdrawal.id,
                        txHash: result.txHash || null,
                        reason: result.reason || null
                    }
                );

                return;
            }

            await failWithdrawalBeforeBroadcast(
                withdrawal.id,
                result?.reason ||
                    "Withdrawal processing failed before broadcast."
            );
        } catch (error) {
            console.error(
                "[Withdrawal Worker] Processing error:",
                {
                    id: withdrawal.id,
                    error: error.message,
                    broadcasted: Boolean(error.broadcasted),
                    txHash: error.txHash || null
                }
            );

            if (error.broadcasted) {
                console.error(
                    "[Withdrawal Worker] Automatic refund blocked because a blockchain broadcast may already exist. Manual reconciliation is required.",
                    {
                        id: withdrawal.id,
                        txHash: error.txHash || null
                    }
                );

                return;
            }

            await failWithdrawalBeforeBroadcast(
                withdrawal.id,
                error.message ||
                    "Unexpected processing error before broadcast."
            );
        }
    } catch (error) {
        console.error(
            "[Withdrawal Worker] Error:",
            error
        );
    }
}


/* ==================================================
   EXPORTS
================================================== */

module.exports = {
    runWithdrawalWorker,
    getPendingWithdrawals,
    claimNextPendingWithdrawal,
    failWithdrawalBeforeBroadcast,
    persistBroadcast,
    markWithdrawalCompleted,
    processWithdrawal,
    sendEvmUsdtWithdrawal,
    sendTrc20UsdtWithdrawal
};
