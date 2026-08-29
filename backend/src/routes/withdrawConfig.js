const express = require("express");

const router = express.Router();


/* ==================================================
   PUBLIC WITHDRAWAL NETWORK CONFIGURATION

   The frontend can read withdrawal network settings
   from this endpoint.

   Source of truth:
   Environment variables.

   TON is intentionally not supported.
================================================== */

router.get(
    "/networks",
    (req, res) => {

        const networks = {

            BEP20: {

                enabled:
                    process.env.BEP20_WITHDRAW_ENABLED === "true",

                label:
                    "BEP20 / BNB Smart Chain",

                networkLabel:
                    "Network: BEP20 (BNB Smart Chain)"

            },


            TRC20: {

                enabled:
                    process.env.TRC20_WITHDRAW_ENABLED === "true",

                label:
                    "TRC20 / TRON",

                networkLabel:
                    "Network: TRC20 (TRON)"

            },


            ERC20: {

                enabled:
                    process.env.ERC20_WITHDRAW_ENABLED === "true",

                label:
                    "ERC20 / Ethereum",

                networkLabel:
                    "Network: ERC20 (Ethereum)"

            },


            POLYGON: {

                enabled:
                    process.env.POLYGON_WITHDRAW_ENABLED === "true",

                label:
                    "Polygon PoS",

                networkLabel:
                    "Network: Polygon PoS"

            }

        };


        /*
           Only return networks that are enabled.
        */

        const enabledNetworks = {};


        for (
            const [key, value]
            of Object.entries(networks)
        ) {

            if (value.enabled) {

                enabledNetworks[key] =
                    value;

            }

        }


        return res.json({

            success: true,

            networks:
                enabledNetworks

        });

    }
);


module.exports = router;