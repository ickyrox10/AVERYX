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
        const result = await pool.query(
            "SELECT NOW() AS current_time"
        );

        console.log(
            "PostgreSQL connected successfully:",
            result.rows[0].current_time
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