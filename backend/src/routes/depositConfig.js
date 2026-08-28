const express = require("express");

const router = express.Router();


/* ==================================================
   PUBLIC DEPOSIT NETWORK CONFIGURATION

   The frontend reads deposit addresses from here.

   Source of truth:
   Environment variables.

   No authentication is required because deposit
   receiving addresses are public.
================================================== */

router.get(
    "/networks",
    (req, res) => {

        const networks = {

            BEP20: {

                address:
                    process.env.BEP20_DEPOSIT_ADDRESS || "",

                label:
                    "BEP20 / BNB Smart Chain",

                networkLabel:
                    "Network: BEP20 (BNB Smart Chain)",

                warning:
                    "Send only USDT using the BEP20 (BNB Smart Chain) network to this address. Sending another asset or using another network may result in permanent loss.",

                hashPlaceholder:
                    "0x..."

            },


            TRC20: {

                address:
                    process.env.TRC20_DEPOSIT_ADDRESS || "",

                label:
                    "TRC20 / TRON",

                networkLabel:
                    "Network: TRC20 (TRON)",

                warning:
                    "Send only USDT using the TRC20 (TRON) network to this address. Sending another asset or using another network may result in permanent loss.",

                hashPlaceholder:
                    "TRON transaction hash"

            },


            ERC20: {

                address:
                    process.env.ERC20_DEPOSIT_ADDRESS || "",

                label:
                    "ERC20 / Ethereum",

                networkLabel:
                    "Network: ERC20 (Ethereum)",

                warning:
                    "Send only USDT using the ERC20 (Ethereum) network to this address. Ethereum network fees may apply. Sending another asset or using another network may result in permanent loss.",

                hashPlaceholder:
                    "0x..."

            }

        };


        /*
           Only return networks that actually have
           a deposit address configured.
        */

        const configuredNetworks = {};


        for (
            const [key, value]
            of Object.entries(networks)
        ) {

            if (value.address) {

                configuredNetworks[key] =
                    value;

            }

        }


        return res.json({

            success: true,

            networks:
                configuredNetworks

        });

    }
);


module.exports = router;