const express = require("express");

const router = express.Router();


/* ==================================================
   ENVIRONMENT HELPERS
================================================== */

function getBooleanEnv(name, defaultValue = false) {

    const value = process.env[name];

    if (value === undefined) {
        return defaultValue;
    }

    return String(value)
        .trim()
        .toLowerCase() === "true";

}


function getNumberEnv(name, defaultValue) {

    const value = Number(process.env[name]);

    if (!Number.isFinite(value)) {
        return defaultValue;
    }

    return value;

}


/* ==================================================
   PRIORITY SYSTEM SETTINGS
================================================== */

router.get("/settings", async (req, res) => {

    try {

        const prioritySystemEnabled = getBooleanEnv(
            "WITHDRAWAL_PRIORITY_SYSTEM_ENABLED",
            false
        );


        const normalWithdrawalHoldHours = getNumberEnv(
            "NORMAL_WITHDRAWAL_HOLD_HOURS",
            36
        );


        const premiumWithdrawalHoldHours = getNumberEnv(
            "PREMIUM_WITHDRAWAL_HOLD_HOURS",
            6
        );


        const premiumPassPriceUSDT = getNumberEnv(
            "PREMIUM_PASS_PRICE_USDT",
            10
        );


        const premiumPassRewardUSDT = getNumberEnv(
            "PREMIUM_PASS_REWARD_USDT",
            40
        );


        const premiumPassTotal = getNumberEnv(
            "PREMIUM_PASS_TOTAL",
            20
        );


        return res.json({

            success: true,


            prioritySystemEnabled,


            normalWithdrawalHoldHours,


            premiumWithdrawalHoldHours,


            averyxPremiumPass: {

                enabled:
                    prioritySystemEnabled,


                priceUSDT:
                    premiumPassPriceUSDT,


                rewardUSDT:
                    premiumPassRewardUSDT,


                totalPasses:
                    premiumPassTotal


            }

        });

    } catch (error) {

        console.error(
            "Priority config error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to load priority system settings."

        });

    }

});


module.exports = router;