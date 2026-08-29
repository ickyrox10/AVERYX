require("dotenv").config();

const { pool } = require("./src/db");

async function checkWallet() {
    try {
        const result = await pool.query(`
            SELECT
                t.id AS withdrawal_id,
                t.user_id,
                t.amount_usdt AS withdrawal_amount,
                t.status AS withdrawal_status,
                w.balance_usdt,
                w.withdrawable_usdt
            FROM transactions t
            LEFT JOIN wallets w
                ON w.user_id = t.user_id
            WHERE t.id = 34
        `);

        console.table(result.rows);

    } catch (error) {

        console.error(
            "Database check failed:",
            error.message
        );

    } finally {

        await pool.end();

    }
}

checkWallet();