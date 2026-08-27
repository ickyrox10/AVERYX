const { Pool } = require("pg");


/* ==================================================
   POSTGRESQL CONNECTION
================================================== */

const pool = new Pool({

    host:
        process.env.DB_HOST,

    port:
        Number(
            process.env.DB_PORT
        ),

    database:
        process.env.DB_NAME,

    user:
        process.env.DB_USER,

    password:
        process.env.DB_PASSWORD

});


/* ==================================================
   DATABASE ERROR HANDLER
================================================== */

pool.on(

    "error",

    (error) => {

        console.error(

            "Unexpected PostgreSQL error:",

            error

        );

    }

);


/* ==================================================
   TEST DATABASE CONNECTION
================================================== */

async function testDatabaseConnection() {

    try {


        /* ------------------------------------------
           CHECK DATABASE CONNECTION
        ------------------------------------------ */

        const result =
            await pool.query(`

                SELECT

                    current_database()
                        AS database_name,

                    current_schema()
                        AS schema_name,

                    current_user
                        AS user_name

            `);


        console.log(

            "PostgreSQL connected successfully:"

        );


        console.log(

            result.rows[0]

        );


        /* ------------------------------------------
           CHECK TABLE STRUCTURE

           This ONLY reads information.
           It does NOT modify the database.
        ------------------------------------------ */

        const tables =
            await pool.query(`

                SELECT

                    table_name,

                    column_name,

                    data_type

                FROM

                    information_schema.columns

                WHERE

                    table_name IN (

                        'users',

                        'wallets',

                        'transactions'

                    )

                ORDER BY

                    table_name,

                    ordinal_position

            `);


        console.log(

            "===================================="

        );


        console.log(

            "DATABASE TABLE STRUCTURE:"

        );


        console.log(

            "===================================="

        );


        console.table(

            tables.rows

        );


        console.log(

            "===================================="

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


/* ==================================================
   EXPORT
================================================== */

module.exports = {

    pool,

    testDatabaseConnection

};