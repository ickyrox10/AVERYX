require("dotenv").config();

const { pool } = require("./src/db");

async function checkTransactionColumns() {
    try {
        const result = await pool.query(`
            SELECT
                column_name,
                data_type,
                is_nullable,
                column_default
            FROM information_schema.columns
            WHERE table_name = 'transactions'
            ORDER BY ordinal_position;
        `);

        console.table(result.rows);

    } catch (error) {
        console.error("Database check failed:", error.message);

    } finally {
        await pool.end();
    }
}

checkTransactionColumns();