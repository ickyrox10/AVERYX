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

        processingMode: row.processing_mode || null,
        priorityType: row.priority_type || null,
        eligibleAt: row.eligible_at || null,

        createdAt: row.created_at
    };
}

function toDeposit(row) {
    return {
        id: row.id,
        userId: row.user_id,
        nickname: row.nickname || null,
        email: row.email || null,
        amountUSDT: row.amount_usdt === null ? null : Number(row.amount_usdt),
        status: row.status,
        reference: row.reference,
        txHash: row.tx_hash,
        network: row.network,
        fromAddress: row.from_address,
        toAddress: row.to_address,
        createdAt: row.created_at
    };
}



function calculateTierFromBalance(value) {
    const balance = Math.max(
        0,
        Number(value) || 0
    );

    const tiers = [
        { level: 1, name: "The Fool", deposit: 0 },
        { level: 2, name: "The Prodigy", deposit: 3.5 },
        { level: 3, name: "The Magician", deposit: 16 },
        { level: 4, name: "The Conqueror", deposit: 60 },
        { level: 5, name: "The Emperor", deposit: 165 },
        { level: 6, name: "The Shadow Monarch", deposit: 550 },
        { level: 7, name: "The Berserk", deposit: 1440 }
    ];

    let currentTier = tiers[0];

    for (const tier of tiers) {
        if (balance >= tier.deposit) {
            currentTier = tier;
        }
    }

    return currentTier;
}


function toAdminUser(row) {
    const balanceUSDT =
        row.balance_usdt === null
            ? 0
            : Number(row.balance_usdt);

    const tier =
        calculateTierFromBalance(
            balanceUSDT
        );

    return {
        id: row.id,
        publicUid: row.public_uid || null,
        nickname: row.nickname || null,
        email: row.email || null,
        phone: row.phone || null,
        referralCode: row.referral_code || null,
        isActive: row.is_active === true,

        accountStatus:
            row.account_status || "ACTIVE",

        suspendedAt:
            row.suspended_at || null,

        suspensionReason:
            row.suspension_reason || null,

        balanceUSDT,

        withdrawableUSDT:
            row.withdrawable_usdt === null
                ? 0
                : Number(row.withdrawable_usdt),

        /*
           The working user-facing tier pages calculate
           the real unlocked tier from live wallet balance.
           Do the same here instead of trusting profile
           fields that may be stale or only local.
        */
        currentTier: tier.level,
        currentTierName: tier.name,
        currentTierDepositRequirement: tier.deposit,

        /*
           Keep these existing field names for admin.html.
           The frontend already reads these names in both
           the table and the user details popup.
        */
        highestUnlockedTier: tier.level,
        selectedProfileTier: tier.level,

        highestUnlockedTierName: tier.name,
        selectedProfileTierName: tier.name,

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

        if (
            username.toLowerCase() !==
            configuredUsername.toLowerCase()
        ) {
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
                    t.processing_mode,
                    t.priority_type,
                    t.eligible_at,
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
                    t.processing_mode,
                    t.priority_type,
                    t.eligible_at,
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

   Only pending withdrawals can be completed manually.
   A transaction hash is required.

   This prevents:
   - Completing a failed withdrawal
   - Overwriting an existing transaction hash
   - Re-completing an already completed withdrawal
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

        const currentStatus =
            String(current.status || "")
                .toLowerCase()
                .trim();

        if (currentStatus === "completed") {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "Withdrawal is already completed."
            });
        }

        if (currentStatus === "failed") {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "Failed withdrawals cannot be completed."
            });
        }

        if (current.tx_hash) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "Withdrawal already has a transaction hash."
            });
        }

        if (currentStatus !== "pending") {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: `Withdrawal cannot be manually completed while status is ${currentStatus || "unknown"}.`
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
                    processing_mode,
                    priority_type,
                    eligible_at,
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

   Only pending withdrawals can be failed.

   IMPORTANT:
   The status check makes the refund idempotent.
   Once failed, the withdrawal cannot be failed again,
   preventing the user's balance from being restored twice.

   A withdrawal with a transaction hash cannot be refunded.
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

        const currentStatus =
            String(withdrawal.status || "")
                .toLowerCase()
                .trim();

        if (withdrawal.tx_hash) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "Withdrawal already has a transaction hash. Automatic refund is blocked."
            });
        }

        if (currentStatus === "completed") {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "Completed withdrawals cannot be failed."
            });
        }

        if (currentStatus === "failed") {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "Withdrawal is already failed. Funds have already been restored."
            });
        }

        if (currentStatus !== "pending") {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: `Withdrawal cannot be failed while status is ${currentStatus || "unknown"}.`
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
                    processing_mode,
                    priority_type,
                    eligible_at,
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


/* ==================================================
   GET ADMIN APPROVAL WITHDRAWALS

   Shows only withdrawals that require manual admin
   attention:
   - Premium/manual withdrawals
   - Pending TRC20 withdrawals

   Existing withdrawal APIs remain unchanged.
================================================== */

async function getAdminApprovals(req, res) {
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
                    t.processing_mode,
                    t.priority_type,
                    t.eligible_at,
                    t.created_at,
                    CASE
                        WHEN UPPER(COALESCE(t.network, '')) = 'TRC20'
                            THEN 'TRC20'
                        WHEN LOWER(COALESCE(t.priority_type, '')) = 'premium'
                            OR LOWER(COALESCE(t.processing_mode, '')) = 'manual'
                            THEN 'PREMIUM'
                        ELSE 'MANUAL'
                    END AS approval_category
                FROM transactions t
                LEFT JOIN users u
                    ON u.id = t.user_id
                WHERE
                    t.type = 'withdrawal'
                    AND LOWER(t.status) = 'pending'
                    AND (
                        UPPER(COALESCE(t.network, '')) = 'TRC20'
                        OR LOWER(COALESCE(t.priority_type, '')) = 'premium'
                        OR LOWER(COALESCE(t.processing_mode, '')) = 'manual'
                    )
                ORDER BY t.created_at ASC
                `
            );

        return res.status(200).json({
            success: true,
            approvals: result.rows.map(row => ({
                ...toWithdrawal(row),
                approvalCategory: row.approval_category
            }))
        });

    } catch (error) {
        console.error(
            "Get admin approvals error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Unable to load admin approvals."
        });
    }
}


/* ==================================================
   GET ADMIN APPROVAL STATISTICS

   Premium Requests = currently pending premium/manual
   withdrawals.

   Premium Approved = completed premium/manual
   withdrawals.

   TRC20 Requests = currently pending TRC20 withdrawals.

   TRC20 Accepted = completed TRC20 withdrawals.
================================================== */

async function getAdminApprovalStats(req, res) {
    try {
        const result =
            await pool.query(
                `
                SELECT
                    COUNT(*) FILTER (
                        WHERE
                            LOWER(t.status) = 'pending'
                            AND (
                                LOWER(COALESCE(t.priority_type, '')) = 'premium'
                                OR (
                                    LOWER(COALESCE(t.processing_mode, '')) = 'manual'
                                    AND UPPER(COALESCE(t.network, '')) <> 'TRC20'
                                )
                            )
                    ) AS premium_requests,

                    COUNT(*) FILTER (
                        WHERE
                            LOWER(t.status) = 'completed'
                            AND (
                                LOWER(COALESCE(t.priority_type, '')) = 'premium'
                                OR (
                                    LOWER(COALESCE(t.processing_mode, '')) = 'manual'
                                    AND UPPER(COALESCE(t.network, '')) <> 'TRC20'
                                )
                            )
                    ) AS premium_approved,

                    COUNT(*) FILTER (
                        WHERE
                            LOWER(t.status) = 'pending'
                            AND UPPER(COALESCE(t.network, '')) = 'TRC20'
                    ) AS trc20_requests,

                    COUNT(*) FILTER (
                        WHERE
                            LOWER(t.status) = 'completed'
                            AND UPPER(COALESCE(t.network, '')) = 'TRC20'
                    ) AS trc20_accepted

                FROM transactions t
                WHERE t.type = 'withdrawal'
                `
            );

        const stats = result.rows[0] || {};

        return res.status(200).json({
            success: true,
            stats: {
                premiumRequests:
                    Number(stats.premium_requests || 0),
                premiumApproved:
                    Number(stats.premium_approved || 0),
                trc20Requests:
                    Number(stats.trc20_requests || 0),
                trc20Accepted:
                    Number(stats.trc20_accepted || 0)
            }
        });

    } catch (error) {
        console.error(
            "Get admin approval stats error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Unable to load admin approval statistics."
        });
    }
}


/* ==================================================
   GET ALL DEPOSITS - READ ONLY
================================================== */

async function getAdminDeposits(req, res) {
    try {
        const result = await pool.query(`
            SELECT
                t.id,
                t.user_id,
                u.nickname,
                u.email,
                t.amount_usdt,
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
            WHERE LOWER(t.type) = 'deposit'
            ORDER BY t.created_at DESC
        `);

        return res.status(200).json({
            success: true,
            deposits: result.rows.map(toDeposit)
        });

    } catch (error) {
        console.error("Get admin deposits error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to load deposits."
        });
    }
}


/* ==================================================
   GET ONE DEPOSIT - READ ONLY
================================================== */

async function getAdminDepositById(req, res) {
    try {
        const depositId = Number(req.params.id);

        if (!Number.isInteger(depositId) || depositId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid deposit ID."
            });
        }

        const result = await pool.query(
            `
            SELECT
                t.id,
                t.user_id,
                u.nickname,
                u.email,
                t.amount_usdt,
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
                AND LOWER(t.type) = 'deposit'
            LIMIT 1
            `,
            [depositId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Deposit not found."
            });
        }

        return res.status(200).json({
            success: true,
            deposit: toDeposit(result.rows[0])
        });

    } catch (error) {
        console.error("Get admin deposit error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to load deposit."
        });
    }
}


/* ==================================================
   GET ALL USERS - READ ONLY
================================================== */

async function getAdminUsers(req, res) {
    try {
        const result = await pool.query(
            `
            SELECT
                u.id,
                u.public_uid,
                u.nickname,
                u.email,
                u.phone,
                u.referral_code,
                u.is_active,
                u.account_status,
                u.suspended_at,
                u.suspension_reason,
                u.created_at,

                COALESCE(
                    w.balance_usdt,
                    0
                ) AS balance_usdt,

                COALESCE(
                    w.withdrawable_usdt,
                    0
                ) AS withdrawable_usdt

            FROM users u

            LEFT JOIN wallets w
                ON w.user_id = u.id

            ORDER BY u.created_at DESC
            `
        );

        return res.status(200).json({
            success: true,
            users: result.rows.map(toAdminUser)
        });

    } catch (error) {
        console.error(
            "Get admin users error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Unable to load users."
        });
    }
}


/* ==================================================
   GET ONE USER - READ ONLY
================================================== */

async function getAdminUserById(req, res) {
    try {
        const userId = Number(req.params.id);

        if (
            !Number.isInteger(userId) ||
            userId <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID."
            });
        }

        const result = await pool.query(
            `
            SELECT
                u.id,
                u.public_uid,
                u.nickname,
                u.email,
                u.phone,
                u.referral_code,
                u.is_active,
                u.account_status,
                u.suspended_at,
                u.suspension_reason,
                u.created_at,

                COALESCE(
                    w.balance_usdt,
                    0
                ) AS balance_usdt,

                COALESCE(
                    w.withdrawable_usdt,
                    0
                ) AS withdrawable_usdt

            FROM users u

            LEFT JOIN wallets w
                ON w.user_id = u.id

            WHERE u.id = $1

            LIMIT 1
            `,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        return res.status(200).json({
            success: true,
            user: toAdminUser(result.rows[0])
        });

    } catch (error) {
        console.error(
            "Get admin user error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Unable to load user."
        });
    }
}



/* ==================================================
   SUSPEND USER ACCOUNT
================================================== */

async function suspendAdminUser(req, res) {
    try {
        const userId = Number(req.params.id);

        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID."
            });
        }

        const suspensionReason = String(
            req.body.suspensionReason ||
            req.body.suspension_reason ||
            ""
        ).trim();

        const result = await pool.query(
            `
            UPDATE users
            SET
                account_status = 'SUSPENDED',
                suspended_at = NOW(),
                suspension_reason = $2
            WHERE id = $1
            RETURNING
                id,
                public_uid,
                account_status,
                suspended_at,
                suspension_reason
            `,
            [userId, suspensionReason || null]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        const user = result.rows[0];

        return res.status(200).json({
            success: true,
            message: "User suspended successfully.",
            user: {
                id: user.id,
                publicUid: user.public_uid,
                accountStatus: user.account_status,
                suspendedAt: user.suspended_at,
                suspensionReason: user.suspension_reason
            }
        });

    } catch (error) {
        console.error("Suspend admin user error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to suspend user."
        });
    }
}


/* ==================================================
   REACTIVATE USER ACCOUNT
================================================== */

async function reactivateAdminUser(req, res) {
    try {
        const userId = Number(req.params.id);

        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID."
            });
        }

        const result = await pool.query(
            `
            UPDATE users
            SET
                account_status = 'ACTIVE',
                suspended_at = NULL,
                suspension_reason = NULL
            WHERE id = $1
            RETURNING
                id,
                public_uid,
                account_status,
                suspended_at,
                suspension_reason
            `,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        const user = result.rows[0];

        return res.status(200).json({
            success: true,
            message: "User reactivated successfully.",
            user: {
                id: user.id,
                publicUid: user.public_uid,
                accountStatus: user.account_status,
                suspendedAt: user.suspended_at,
                suspensionReason: user.suspension_reason
            }
        });

    } catch (error) {
        console.error("Reactivate admin user error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to reactivate user."
        });
    }
}

module.exports = {
    adminLogin,
    getAdminWithdrawals,
    getAdminWithdrawalById,
    getAdminApprovals,
    getAdminApprovalStats,
    completeAdminWithdrawal,
    failAdminWithdrawal,
    getAdminDeposits,
    getAdminDepositById,
    getAdminUsers,
    getAdminUserById,
    suspendAdminUser,
    reactivateAdminUser
};