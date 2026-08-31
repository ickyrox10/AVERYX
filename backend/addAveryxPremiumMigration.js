require("dotenv").config();

const { pool } = require("./src/db");

async function runMigration() {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        console.log("Starting AVERYX Premium migration...");

        /*
        ==================================================
        1. ADD PRIORITY COLUMNS TO TRANSACTIONS
        ==================================================
        */

        await client.query(`
            ALTER TABLE transactions
            ADD COLUMN IF NOT EXISTS processing_mode VARCHAR(20),
            ADD COLUMN IF NOT EXISTS priority_type VARCHAR(20),
            ADD COLUMN IF NOT EXISTS eligible_at TIMESTAMPTZ
        `);

        console.log("✓ Withdrawal priority columns checked.");


        /*
        ==================================================
        2. ADD PREMIUM STATUS TO USERS
        ==================================================
        */

        await client.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS averyx_premium_active BOOLEAN
                NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS averyx_premium_activated_at TIMESTAMPTZ
        `);

        console.log("✓ AVERYX Premium user columns checked.");


        /*
        ==================================================
        3. CREATE AVERYX PREMIUM PASS PURCHASES TABLE
        ==================================================
        */

        await client.query(`
            CREATE TABLE IF NOT EXISTS averyx_premium_pass_purchases (
                id BIGSERIAL PRIMARY KEY,

                user_id BIGINT NOT NULL,

                tx_hash TEXT NOT NULL,

                network VARCHAR(20) NOT NULL,

                amount_usdt NUMERIC(20, 6) NOT NULL,

                from_address TEXT,

                to_address TEXT,

                status VARCHAR(30) NOT NULL DEFAULT 'completed',

                activated_at TIMESTAMPTZ,

                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

                CONSTRAINT fk_averyx_premium_user
                    FOREIGN KEY (user_id)
                    REFERENCES users(id)
                    ON DELETE CASCADE
            )
        `);

        console.log("✓ AVERYX Premium purchases table checked.");


        /*
        ==================================================
        4. PREVENT DUPLICATE PREMIUM TX HASHES
        ==================================================
        */

        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS
            idx_averyx_premium_pass_tx_hash_unique
            ON averyx_premium_pass_purchases (LOWER(tx_hash))
        `);

        console.log("✓ Premium transaction hash protection checked.");


        /*
        ==================================================
        5. INDEX FOR USER PREMIUM LOOKUPS
        ==================================================
        */

        await client.query(`
            CREATE INDEX IF NOT EXISTS
            idx_averyx_premium_pass_user_id
            ON averyx_premium_pass_purchases (user_id)
        `);

        console.log("✓ Premium user lookup index checked.");


        /*
        ==================================================
        6. INDEX FOR PRIORITY WITHDRAWAL WORKER
        ==================================================
        */

        await client.query(`
            CREATE INDEX IF NOT EXISTS
            idx_transactions_priority_processing
            ON transactions (
                status,
                processing_mode,
                eligible_at
            )
            WHERE type = 'withdrawal'
        `);

        console.log("✓ Priority withdrawal index checked.");

        await client.query("COMMIT");

        console.log("");
        console.log("==============================================");
        console.log("AVERYX PREMIUM DATABASE MIGRATION COMPLETE");
        console.log("==============================================");

    } catch (error) {

        await client.query("ROLLBACK");

        console.error("");
        console.error("Migration failed:");
        console.error(error);

        process.exitCode = 1;

    } finally {

        client.release();

        await pool.end();
    }
}

runMigration();