const { Pool } = require("pg");

const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});

pool.on("error", (error) => {
    console.error(
        "Unexpected PostgreSQL error:",
        error
    );
});

async function testDatabaseConnection() {
    try {

        const result = await pool.query(`
            SELECT
                current_database() AS database_name,
                current_schema() AS schema_name,
                current_user AS user_name
        `);

        console.log(
            "PostgreSQL connected successfully:"
        );

        console.log(
            result.rows[0]
        );

        const tables = await pool.query(`
            SELECT
                table_schema,
                table_name
            FROM information_schema.tables
            WHERE table_name = 'wallets'
        `);

        console.log(
            "Wallet table check:",
            tables.rows
        );

    } catch (error) {

        console.error(
            "PostgreSQL connection failed:"
        );

        console.error(
            error.message
        );

        process.exit(1);
    }
}

module.exports = {
    pool,
    testDatabaseConnection
};