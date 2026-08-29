const { pool } = require("./db");


/* ==================================================
   WITHDRAWAL WORKER
================================================== */


/*
   IMPORTANT SAFETY RULE

   This first version DOES NOT send any crypto.

   It is only the worker foundation.

   By default:

   WITHDRAWAL_WORKER_ENABLED=false

   So deploying this file cannot accidentally process
   or move any real withdrawal.
*/


const WORKER_ENABLED =
    String(
        process.env.WITHDRAWAL_WORKER_ENABLED
    ).toLowerCase() === "true";


const DRY_RUN =
    String(
        process.env.WITHDRAWAL_WORKER_DRY_RUN ?? "true"
    ).toLowerCase() !== "false";



/* ==================================================
   GET PENDING WITHDRAWALS
================================================== */

async function getPendingWithdrawals() {

    const result =
        await pool.query(
            `
            SELECT
                id,
                user_id,
                type,
                amount_usdt,
                status,
                reference,
                tx_hash,
                network,
                from_address,
                to_address,
                created_at

            FROM transactions

            WHERE
                type = 'withdrawal'

                AND LOWER(status) = 'pending'

                AND tx_hash IS NULL

            ORDER BY
                created_at ASC

            LIMIT 10
            `
        );


    return result.rows;

}



/* ==================================================
   SAFELY CLAIM ONE WITHDRAWAL

   This is the important concurrency protection.

   SKIP LOCKED prevents two worker processes from
   claiming the same withdrawal at the same time.
================================================== */

async function claimNextPendingWithdrawal() {

    const client =
        await pool.connect();


    try {

        await client.query(
            "BEGIN"
        );


        const result =
            await client.query(
                `
                WITH next_withdrawal AS (

                    SELECT
                        id

                    FROM transactions

                    WHERE
                        type = 'withdrawal'

                        AND LOWER(status) = 'pending'

                        AND tx_hash IS NULL

                    ORDER BY
                        created_at ASC

                    LIMIT 1

                    FOR UPDATE SKIP LOCKED

                )

                UPDATE transactions

                SET
                    status = 'processing'

                WHERE
                    id IN (
                        SELECT id
                        FROM next_withdrawal
                    )

                RETURNING
                    id,
                    user_id,
                    type,
                    amount_usdt,
                    status,
                    reference,
                    tx_hash,
                    network,
                    from_address,
                    to_address,
                    created_at
                `
            );


        await client.query(
            "COMMIT"
        );


        if (
            result.rows.length === 0
        ) {

            return null;

        }


        return result.rows[0];


    } catch (error) {

        try {

            await client.query(
                "ROLLBACK"
            );

        } catch (_) {

        }


        throw error;


    } finally {

        client.release();

    }

}



/* ==================================================
   PROCESS ONE WITHDRAWAL

   BLOCKCHAIN SENDING IS NOT IMPLEMENTED YET.

   This function is where the future network-specific
   sender will be connected.
================================================== */

async function processWithdrawal(
    withdrawal
) {

    console.log(
        "[Withdrawal Worker] Processing foundation:",
        {
            id:
                withdrawal.id,

            network:
                withdrawal.network,

            amount:
                withdrawal.amount_usdt,

            recipient:
                withdrawal.to_address
        }
    );


    /*
       FUTURE FLOW:

       BEP20
       ERC20
       POLYGON
           ↓
       Provider / Gas System
           ↓
       Broadcast USDT
           ↓
       Save tx_hash
           ↓
       BROADCASTED


       TRC20
           ↓
       TRON Sender
           ↓
       Broadcast
           ↓
       Save tx_hash
    */


    return {

        success: false,

        reason:
            "Blockchain withdrawal sending is not implemented yet."

    };

}



/* ==================================================
   RUN WITHDRAWAL WORKER
================================================== */

async function runWithdrawalWorker() {

    if (!WORKER_ENABLED) {

        return;

    }


    try {

        /*
           DRY RUN

           Only checks and logs pending withdrawals.

           It DOES NOT change their status.
        */

        if (DRY_RUN) {

            const pendingWithdrawals =
                await getPendingWithdrawals();


            if (
                pendingWithdrawals.length > 0
            ) {

                console.log(
                    `[Withdrawal Worker] ${pendingWithdrawals.length} pending withdrawal(s) found.`
                );

            }


            return;

        }



        /*
           LIVE PROCESSING MODE

           WARNING:

           Do not enable this yet.

           The worker can claim a withdrawal and change
           its status to PROCESSING.

           We will only enable this after the actual
           blockchain sender and failure recovery system
           are implemented.
        */

        const withdrawal =
            await claimNextPendingWithdrawal();


        if (!withdrawal) {

            return;

        }


        await processWithdrawal(
            withdrawal
        );


    } catch (error) {

        console.error(
            "[Withdrawal Worker] Error:",
            error
        );

    }

}



/* ==================================================
   EXPORTS
================================================== */

module.exports = {

    runWithdrawalWorker,

    getPendingWithdrawals,

    claimNextPendingWithdrawal

};