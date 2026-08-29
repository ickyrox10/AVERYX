require("dotenv").config();

const { pool } = require("./src/db");

async function checkWithdrawals() {
    try {
        const result = await pool.query(`
            SELECT
                id,
                amount_usdt,
                status,
                network,
                to_address,
                tx_hash,
                created_at
            FROM transactions
            WHERE type = 'withdrawal'
            ORDER BY created_at DESC
        `);

        console.table(result.rows);

    } catch (error) {
        console.error("Database check failed:", error.message);

    } finally {
        await pool.end();
    }
}

checkWithdrawals();