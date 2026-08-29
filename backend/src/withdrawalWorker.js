const { pool } = require("./db");


/* ==================================================
   WITHDRAWAL WORKER
================================================== */


/*
   IMPORTANT SAFETY RULE

   This worker does NOT currently send cryptocurrency.

   It provides the safe processing foundation.

   Environment controls:

   WITHDRAWAL_WORKER_ENABLED=false
   WITHDRAWAL_WORKER_DRY_RUN=true
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

   SKIP LOCKED prevents multiple workers from
   claiming the same withdrawal simultaneously.
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
   FAIL WITHDRAWAL SAFELY

   IMPORTANT:

   Funds are restored ONLY when the withdrawal has
   NOT been broadcast to the blockchain.

   Rule:

   tx_hash exists
       ↓
   NEVER automatically refund


   tx_hash is NULL
       ↓
   Mark FAILED
       ↓
   Restore withdrawable_usdt
================================================== */

async function failWithdrawalBeforeBroadcast(
    withdrawalId,
    reason
) {

    const client =
        await pool.connect();


    try {

        await client.query(
            "BEGIN"
        );


        /*
           Lock the withdrawal row.

           This prevents concurrent processing from
           changing its state during recovery.
        */

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
                [
                    withdrawalId
                ]
            );


        if (
            withdrawalResult.rows.length === 0
        ) {

            await client.query(
                "ROLLBACK"
            );


            return {

                success: false,

                reason:
                    "Withdrawal record not found."

            };

        }


        const withdrawal =
            withdrawalResult.rows[0];


        /*
           CRITICAL RULE

           If a blockchain transaction hash exists,
           the transaction may already be on-chain.

           Never automatically refund.
        */

        if (
            withdrawal.tx_hash
        ) {

            await client.query(
                "COMMIT"
            );


            return {

                success: false,

                reason:
                    "Transaction was already broadcast. Automatic refund blocked."

            };

        }


        /*
           Only PROCESSING withdrawals should be
           failed by this recovery path.
        */

        if (
            String(
                withdrawal.status
            ).toLowerCase() !== "processing"
        ) {

            await client.query(
                "COMMIT"
            );


            return {

                success: false,

                reason:
                    "Withdrawal is not currently processing."

            };

        }


        /*
           Lock the user's wallet before restoring
           reserved funds.
        */

        const walletResult =
            await client.query(
                `
                SELECT
                    id,
                    withdrawable_usdt

                FROM wallets

                WHERE
                    user_id = $1

                FOR UPDATE
                `,
                [
                    withdrawal.user_id
                ]
            );


        if (
            walletResult.rows.length === 0
        ) {

            throw new Error(
                "User wallet not found during withdrawal recovery."
            );

        }


        /*
           Restore the reserved amount.

           IMPORTANT:

           We restore ONLY withdrawable_usdt.

           balance_usdt is not modified here because
           withdrawal reservation originally deducted
           only withdrawable_usdt.
        */

        await client.query(
            `
            UPDATE wallets

            SET
                withdrawable_usdt =
                    withdrawable_usdt + $1,

                updated_at = NOW()

            WHERE
                user_id = $2
            `,
            [
                withdrawal.amount_usdt,
                withdrawal.user_id
            ]
        );


        /*
           Mark the withdrawal as FAILED.

           The reason is stored in reference only if
           your current transaction schema uses that
           field for internal references.

           We preserve the original reference rather
           than overwriting it.
        */

        await client.query(
            `
            UPDATE transactions

            SET
                status = 'failed'

            WHERE
                id = $1

                AND tx_hash IS NULL

                AND LOWER(status) = 'processing'
            `,
            [
                withdrawal.id
            ]
        );


        await client.query(
            "COMMIT"
        );


        console.log(
            "[Withdrawal Worker] Withdrawal failed before broadcast and funds restored:",
            {
                id:
                    withdrawal.id,

                user_id:
                    withdrawal.user_id,

                amount:
                    withdrawal.amount_usdt,

                reason
            }
        );


        return {

            success: true,

            withdrawalId:
                withdrawal.id,

            restoredAmount:
                withdrawal.amount_usdt

        };


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

        broadcasted: false,

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

           Currently this should NOT be enabled until
           a real blockchain sender is connected.

           If processWithdrawal fails before broadcast,
           reserved funds are restored safely.
        */

        const withdrawal =
            await claimNextPendingWithdrawal();


        if (!withdrawal) {

            return;

        }


        try {

            const result =
                await processWithdrawal(
                    withdrawal
                );


            /*
               Future blockchain senders should return:

               {
                   success: true,
                   broadcasted: true,
                   txHash: "..."
               }

               If broadcasted is true, automatic refund
               must never happen.
            */

            if (
                result &&
                result.success === true
            ) {

                return;

            }


            /*
               If broadcast happened, do not refund.
            */

            if (
                result &&
                result.broadcasted === true
            ) {

                console.error(
                    "[Withdrawal Worker] Withdrawal broadcast state requires confirmation handling:",
                    {
                        id:
                            withdrawal.id,

                        txHash:
                            result.txHash || null
                    }
                );


                return;

            }


            /*
               No broadcast occurred.

               Safe to fail and restore funds.
            */

            await failWithdrawalBeforeBroadcast(
                withdrawal.id,

                result?.reason ||
                    "Withdrawal processing failed before broadcast."
            );


        } catch (error) {

            console.error(
                "[Withdrawal Worker] Processing error:",
                {
                    id:
                        withdrawal.id,

                    error:
                        error.message
                }
            );


            /*
               We are inside the processing error path.

               The recovery helper checks tx_hash again
               inside a database lock before restoring
               any funds.

               Therefore it cannot automatically refund
               a withdrawal that already has a stored
               transaction hash.
            */

            await failWithdrawalBeforeBroadcast(
                withdrawal.id,

                error.message ||
                    "Unexpected processing error before broadcast."
            );

        }


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

    claimNextPendingWithdrawal,

    failWithdrawalBeforeBroadcast

};