const express = require("express");
const cors = require("cors");
require("dotenv").config();


const {
    testDatabaseConnection
} = require("./db");


const {
    settleAllDueRewards
} = require("./controllers/walletController");


const authRoutes =
    require("./routes/auth");


const walletRoutes =
    require("./routes/wallet");


const depositConfigRoutes =
    require("./routes/depositConfig");


const withdrawConfigRoutes =
    require("./routes/withdrawConfig");


/* ==================================================
   REFERRAL ROUTES
================================================== */

const referralRoutes =
    require("./routes/referral");


const app =
    express();


const PORT =
    process.env.PORT || 3000;


/* ==================================================
   MIDDLEWARE
================================================== */

app.use(
    cors({
        origin: true,
        credentials: true
    })
);


app.use(
    express.json()
);


/* ==================================================
   API ROUTES
================================================== */

app.use(
    "/api/auth",
    authRoutes
);


app.use(
    "/api/wallet",
    walletRoutes
);


/*
   Public deposit addresses / network display config
*/
/*
   Public deposit addresses / network display config
*/
app.use(
    "/api/deposit",
    depositConfigRoutes
);


/*
   Public withdrawal network configuration
*/
app.use(
    "/api/withdraw",
    withdrawConfigRoutes
);


/*
   Referral statistics / referral data
*/
app.use(
    "/api/referrals",
    referralRoutes
);


/*
   Referral statistics / referral data
*/

app.use(
    "/api/referrals",
    referralRoutes
);


/* ==================================================
   HOME
================================================== */

app.get(
    "/",
    (req, res) => {

        res.json({

            success: true,

            message:
                "AVERYX backend is running"

        });

    }
);


/* ==================================================
   HEALTH CHECK
================================================== */

app.get(
    "/api/health",
    (req, res) => {

        res.json({

            success: true,

            status:
                "online"

        });

    }
);


/* ==================================================
   404 HANDLER
================================================== */

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            message:
                "API route not found"

        });

    }
);


/* ==================================================
   ERROR HANDLER
================================================== */

app.use(
    (error, req, res, next) => {

        console.error(
            "Server error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Internal server error"

        });

    }
);


/* ==================================================
   DAILY REWARD WORKER

   India reset:
   4:30 PM IST

   The browser countdown is only visual.

   The backend is the actual source of truth.

   Every minute the backend checks whether
   a reward cycle has completed.

   Only the user's CURRENT / HIGHEST
   unlocked tier is credited.

   Example:

   Emperor = 49.5 USDT/day

   The user receives:
   49.5 USDT

   NOT:

   1 + 5 + 18 + 49.5
================================================== */

function startDailyRewardWorker() {

    const run =
        async () => {

            try {

                await settleAllDueRewards();


                console.log(
                    "AVERYX daily reward check completed."
                );

            } catch (error) {

                console.error(
                    "AVERYX daily reward worker error:",
                    error
                );

            }

        };


    /*
       Check immediately when the server starts.
    */

    run();


    /*
       Then check once every minute.

       The wallet controller prevents duplicate
       reward credits even if this runs multiple
       times around the reset boundary.
    */

    setInterval(
        run,
        60 * 1000
    );

}


/* ==================================================
   START SERVER
================================================== */

async function startServer() {

    try {

        await testDatabaseConnection();


        app.listen(
            PORT,
            () => {

                console.log(
                    `AVERYX backend running on port ${PORT}`
                );


                startDailyRewardWorker();

            }
        );

    } catch (error) {

        console.error(
            "Failed to start AVERYX backend."
        );


        console.error(
            error.message
        );


        process.exit(1);

    }

}


startServer();