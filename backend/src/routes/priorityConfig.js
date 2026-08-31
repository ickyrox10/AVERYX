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

    return String(value).trim().toLowerCase() === "true";
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

        const averyxPremiumPassPriceUSDT = getNumberEnv(
            "AVERYX_PREMIUM_PASS_PRICE_USDT",
            10
        );

        const averyxPremiumPassRewardUSDT = getNumberEnv(
            "AVERYX_PREMIUM_PASS_REWARD_USDT",
            40
        );

        const averyxPremiumPassTotal = getNumberEnv(
            "AVERYX_PREMIUM_PASS_TOTAL",
            20
        );


        return res.json({

            success: true,

            prioritySystemEnabled,

            normalWithdrawalHoldHours,

            averyxPremiumPass: {

                enabled: prioritySystemEnabled,

                priceUSDT: averyxPremiumPassPriceUSDT,

                rewardUSDT: averyxPremiumPassRewardUSDT,

                totalPasses: averyxPremiumPassTotal

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