const argon2 = require("argon2");
const jwt = require("jsonwebtoken");

const { pool } = require("../db");


function toWithdrawal(row) {
    return {
        id: row.id,
        userId: row.user_id,
        nickname: row.nickname || null,
        email: row.email || null,
        amountUSDT: Number(row.amount_usdt),
        recipientAmountUSDT:
            row.recipient_amount_usdt === null
                ? null
                : Number(row.recipient_amount_usdt),
        gasCostUSDT:
            row.gas_cost_usdt === null
                ? null
                : Number(row.gas_cost_usdt),
        marginUSDT:
            row.margin_usdt === null
                ? null
                : Number(row.margin_usdt),
        status: row.status,
        reference: row.reference,
        txHash: row.tx_hash,
        network: row.network,
        fromAddress: row.from_address,
        toAddress: row.to_address,
        createdAt: row.created_at
    };
}


/* ==================================================
   ADMIN LOGIN
================================================== */

async function adminLogin(req, res) {
    try {
        const username =
            String(req.body.username || "").trim();

        const password =
            String(req.body.password || "");

        const configuredUsername =
            String(process.env.ADMIN_USERNAME || "").trim();

        const passwordHash =
            process.env.ADMIN_PASSWORD_HASH;

        const secret =
            process.env.ADMIN_JWT_SECRET;

        if (
            !configuredUsername ||
            !passwordHash ||
            !secret
        ) {
            return res.status(500).json({
                success: false,
                message: "Admin login is not configured."
            });
        }

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: "Username and password are required."
            });
        }

        if (username !== configuredUsername) {
            return res.status(401).json({
                success: false,
                message: "Invalid admin credentials."
            });
        }

        const valid =
            await argon2.verify(
                passwordHash,
                password
            );

        if (!valid) {
            return res.status(401).json({
                success: false,
                message: "Invalid admin credentials."
            });
        }

        const token =
            jwt.sign(
                {
                    role: "admin",
                    username: configuredUsername
                },
                secret,
                {
                    expiresIn: "12h"
                }
            );

        return res.status(200).json({
            success: true,
            message: "Admin login successful.",
            token,
            expiresIn: "12h"
        });

    } catch (error) {
        console.error("Admin login error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to complete admin login."
        });
    }
}


/* ==================================================
   GET ALL WITHDRAWALS
================================================== */

async function getAdminWithdrawals(req, res) {
    try {
        const result =
            await pool.query(
                `
                SELECT
                    t.id,
                    t.user_id,
                    u.nickname,
                    u.email,
                    t.amount_usdt,
                    t.recipient_amount_usdt,
                    t.gas_cost_usdt,
                    t.margin_usdt,
                    t.status,
                    t.reference,
                    t.tx_hash,
                    t.network,
                    t.from_address,
                    t.to_address,
                    t.created_at
                FROM transactions t
                LEFT JOIN users u
                    ON u.id = t.user_id
                WHERE t.type = 'withdrawal'
                ORDER BY t.created_at DESC
                `
            );

        return res.status(200).json({
            success: true,
            withdrawals:
                result.rows.map(toWithdrawal)
        });

    } catch (error) {
        console.error(
            "Get admin withdrawals error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Unable to load withdrawals."
        });
    }
}


/* ==================================================
   GET ONE WITHDRAWAL
================================================== */

async function getAdminWithdrawalById(req, res) {
    try {
        const withdrawalId =
            Number(req.params.id);

        if (
            !Number.isInteger(withdrawalId) ||
            withdrawalId <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid withdrawal ID."
            });
        }

        const result =
            await pool.query(
                `
                SELECT
                    t.id,
                    t.user_id,
                    u.nickname,
                    u.email,
                    t.amount_usdt,
                    t.recipient_amount_usdt,
                    t.gas_cost_usdt,
                    t.margin_usdt,
                    t.status,
                    t.reference,
                    t.tx_hash,
                    t.network,
                    t.from_address,
                    t.to_address,
                    t.created_at
                FROM transactions t
                LEFT JOIN users u
                    ON u.id = t.user_id
                WHERE
                    t.id = $1
                    AND t.type = 'withdrawal'
                LIMIT 1
                `,
                [withdrawalId]
            );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Withdrawal not found."
            });
        }

        return res.status(200).json({
            success: true,
            withdrawal:
                toWithdrawal(result.rows[0])
        });

    } catch (error) {
        console.error(
            "Get admin withdrawal error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Unable to load withdrawal."
        });
    }
}


/* ==================================================
   COMPLETE WITHDRAWAL MANUALLY

   Intended for a withdrawal already sent externally.
   A non-empty transaction hash is required.
================================================== */

async function completeAdminWithdrawal(req, res) {
    const client =
        await pool.connect();

    try {
        const withdrawalId =
            Number(req.params.id);

        const txHash =
            String(req.body.txHash || "").trim();

        if (
            !Number.isInteger(withdrawalId) ||
            withdrawalId <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid withdrawal ID."
            });
        }

        if (!txHash) {
            return res.status(400).json({
                success: false,
                message: "Transaction hash is required before marking a withdrawal completed."
            });
        }

        await client.query("BEGIN");

        const currentResult =
            await client.query(
                `
                SELECT
                    id,
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

        if (currentResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                success: false,
                message: "Withdrawal not found."
            });
        }

        const current =
            currentResult.rows[0];

        if (
            String(current.status).toLowerCase() ===
            "completed"
        ) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "Withdrawal is already completed."
            });
        }

        const updateResult =
            await client.query(
                `
                UPDATE transactions
                SET
                    tx_hash = $1,
                    status = 'completed'
                WHERE id = $2
                RETURNING
                    id,
                    user_id,
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
                [
                    txHash,
                    withdrawalId
                ]
            );

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: "Withdrawal marked completed.",
            withdrawal:
                toWithdrawal(updateResult.rows[0])
        });

    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (_) {}

        console.error(
            "Complete admin withdrawal error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Unable to complete withdrawal."
        });

    } finally {
        client.release();
    }
}


/* ==================================================
   FAIL WITHDRAWAL AND RESTORE RESERVED FUNDS

   Only allowed when no transaction hash exists.
   This prevents an accidental refund after broadcast.
================================================== */

async function failAdminWithdrawal(req, res) {
    const client =
        await pool.connect();

    try {
        const withdrawalId =
            Number(req.params.id);

        if (
            !Number.isInteger(withdrawalId) ||
            withdrawalId <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid withdrawal ID."
            });
        }

        await client.query("BEGIN");

        const withdrawalResult =
            await client.query(
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

        if (
            withdrawalResult.rows.length === 0
        ) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                success: false,
                message: "Withdrawal not found."
            });
        }

        const withdrawal =
            withdrawalResult.rows[0];

        if (withdrawal.tx_hash) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "Withdrawal already has a transaction hash. Automatic refund is blocked."
            });
        }

        if (
            String(withdrawal.status).toLowerCase() ===
            "completed"
        ) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "Completed withdrawals cannot be failed."
            });
        }

        const walletResult =
            await client.query(
                `
                SELECT
                    id,
                    withdrawable_usdt
                FROM wallets
                WHERE user_id = $1
                FOR UPDATE
                `,
                [withdrawal.user_id]
            );

        if (
            walletResult.rows.length === 0
        ) {
            await client.query("ROLLBACK");

            return res.status(500).json({
                success: false,
                message: "User wallet not found."
            });
        }

        const wallet =
            walletResult.rows[0];

        const restoredBalance =
            Number(wallet.withdrawable_usdt || 0) +
            Number(withdrawal.amount_usdt || 0);

        await client.query(
            `
            UPDATE wallets
            SET
                withdrawable_usdt = $1,
                updated_at = NOW()
            WHERE id = $2
            `,
            [
                restoredBalance,
                wallet.id
            ]
        );

        const updateResult =
            await client.query(
                `
                UPDATE transactions
                SET status = 'failed'
                WHERE id = $1
                RETURNING
                    id,
                    user_id,
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
                [withdrawalId]
            );

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: "Withdrawal marked failed and funds restored.",
            withdrawal:
                toWithdrawal(updateResult.rows[0])
        });

    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (_) {}

        console.error(
            "Fail admin withdrawal error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Unable to fail withdrawal."
        });

    } finally {
        client.release();
    }
}


module.exports = {
    adminLogin,
    getAdminWithdrawals,
    getAdminWithdrawalById,
    completeAdminWithdrawal,
    failAdminWithdrawal
};
