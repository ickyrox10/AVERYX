require("dotenv").config();

const { pool } = require("./src/db");


async function inspectDatabase() {

    try {

        console.log("\n==============================");
        console.log("ALL DATABASE TABLES");
        console.log("==============================\n");


        const tablesResult =
            await pool.query(`
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                ORDER BY table_name;
            `);


        const tables =
            tablesResult.rows.map(
                row => row.table_name
            );


        console.table(
            tablesResult.rows
        );


        console.log("\n==============================");
        console.log("TABLE COLUMNS");
        console.log("==============================\n");


        const columnsResult =
            await pool.query(`
                SELECT
                    table_name,
                    column_name,
                    data_type,
                    is_nullable,
                    column_default
                FROM information_schema.columns
                WHERE table_schema = 'public'
                ORDER BY
                    table_name,
                    ordinal_position;
            `);


        console.table(
            columnsResult.rows
        );


        console.log("\nDatabase inspection completed.");

    } catch (error) {

        console.error(
            "\nDatabase inspection failed:"
        );

        console.error(
            error.message
        );

    } finally {

        await pool.end();

    }

}


inspectDatabase();