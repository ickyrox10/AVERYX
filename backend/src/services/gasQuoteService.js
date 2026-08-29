const { ethers } = require("ethers");


/* ==================================================
   GAS QUOTE SERVICE

   PURPOSE:

   Estimate the gas cost of a USDT withdrawal and
   calculate the final amount the recipient receives.

   INTERNAL FORMULA:

   actualGasCostUsdt = G

   platformMarginUsdt = G × 40%

   totalFeeUsdt = G × 1.40

   recipientAmount =
       requestedAmount - totalFeeUsdt


   IMPORTANT:

   The platform margin is INTERNAL.

   The frontend should only receive:

   - requestedAmount
   - recipientAmount
   - network
================================================== */


const PLATFORM_MARGIN_PERCENT = 0.40;


const ERC20_ABI = [
    "function transfer(address to, uint256 amount) returns (bool)"
];



/* ==================================================
   NETWORK CONFIGURATION

   Contract addresses will be supplied through
   environment variables.

   We do NOT add private keys here.
================================================== */

function getNetworkConfig(network) {

    const normalizedNetwork =
        String(network || "")
            .trim()
            .toUpperCase();


    const configs = {

        BEP20: {
            rpcUrl:
                process.env.BEP20_RPC_URL,

            usdtContract:
                process.env.BEP20_USDT_CONTRACT,

            nativeSymbol:
                "BNB"
        },


        ERC20: {
            rpcUrl:
                process.env.ERC20_RPC_URL,

            usdtContract:
                process.env.ERC20_USDT_CONTRACT,

            nativeSymbol:
                "ETH"
        },


        POLYGON: {
            rpcUrl:
                process.env.POLYGON_RPC_URL,

            usdtContract:
                process.env.POLYGON_USDT_CONTRACT,

            nativeSymbol:
                "POL"
        }

    };


    const config =
        configs[normalizedNetwork];


    if (!config) {

        throw new Error(
            "Unsupported gas quote network: " +
            normalizedNetwork
        );

    }


    if (!config.rpcUrl) {

        throw new Error(
            normalizedNetwork +
            " RPC URL is not configured."
        );

    }


    if (!config.usdtContract) {

        throw new Error(
            normalizedNetwork +
            " USDT contract is not configured."
        );

    }


    return {
        ...config,
        network:
            normalizedNetwork
    };

}



/* ==================================================
   GET PROVIDER
================================================== */

function getProvider(network) {

    const config =
        getNetworkConfig(network);


    return new ethers.JsonRpcProvider(
        config.rpcUrl
    );

}



/* ==================================================
   GET NATIVE TOKEN PRICE

   IMPORTANT:

   This first version intentionally does NOT fetch
   market prices automatically yet.

   We will connect a reliable price source next.

   For now it expects an environment variable:

   BEP20_BNB_USDT_PRICE
   ERC20_ETH_USDT_PRICE
   POLYGON_POL_USDT_PRICE
================================================== */

function getNativeTokenPriceUsdt(
    network
) {

    const normalizedNetwork =
        String(network || "")
            .trim()
            .toUpperCase();


    const priceVariables = {

        BEP20:
            process.env.BEP20_BNB_USDT_PRICE,

        ERC20:
            process.env.ERC20_ETH_USDT_PRICE,

        POLYGON:
            process.env.POLYGON_POL_USDT_PRICE

    };


    const price =
        Number(
            priceVariables[
                normalizedNetwork
            ]
        );


    if (
        !Number.isFinite(price) ||
        price <= 0
    ) {

        throw new Error(
            "Valid USDT price is not configured for " +
            normalizedNetwork
        );

    }


    return price;

}



/* ==================================================
   ESTIMATE ERC20 USDT TRANSFER GAS
================================================== */

async function estimateUsdtTransferGas(
    network,
    fromAddress,
    toAddress,
    amountUsdt
) {

    const config =
        getNetworkConfig(
            network
        );


    const provider =
        getProvider(
            network
        );


    if (
        !ethers.isAddress(
            fromAddress
        )
    ) {

        throw new Error(
            "Invalid sender address."
        );

    }


    if (
        !ethers.isAddress(
            toAddress
        )
    ) {

        throw new Error(
            "Invalid recipient address."
        );

    }


    const amount =
        Number(
            amountUsdt
        );


    if (
        !Number.isFinite(amount) ||
        amount <= 0
    ) {

        throw new Error(
            "Invalid withdrawal amount."
        );

    }


    /*
       USDT normally uses 6 decimals.

       We will later verify the actual decimals
       directly from each contract.
    */

    const amountUnits =
        ethers.parseUnits(
            amount.toString(),
            6
        );


    const contract =
        new ethers.Contract(
            config.usdtContract,
            ERC20_ABI,
            provider
        );


    const transferData =
        contract.interface.encodeFunctionData(
            "transfer",
            [
                toAddress,
                amountUnits
            ]
        );


    const gasLimit =
        await provider.estimateGas({
            from:
                fromAddress,

            to:
                config.usdtContract,

            data:
                transferData
        });


    const feeData =
        await provider.getFeeData();


    let gasPrice =
        feeData.gasPrice;


    /*
       Some EVM networks may use EIP-1559 fields.
    */

    if (!gasPrice) {

        gasPrice =
            feeData.maxFeePerGas;

    }


    if (!gasPrice) {

        throw new Error(
            "Unable to determine gas price."
        );

    }


    const gasCostWei =
        gasLimit *
        gasPrice;


    const gasCostNative =
        Number(
            ethers.formatEther(
                gasCostWei
            )
        );


    return {

        gasLimit,

        gasPrice,

        gasCostWei,

        gasCostNative,

        nativeSymbol:
            config.nativeSymbol

    };

}



/* ==================================================
   CREATE WITHDRAWAL QUOTE
================================================== */

async function createGasQuote({

    network,

    fromAddress,

    toAddress,

    requestedAmount

}) {

    const amount =
        Number(
            requestedAmount
        );


    if (
        !Number.isFinite(amount) ||
        amount <= 0
    ) {

        throw new Error(
            "Requested withdrawal amount must be greater than zero."
        );

    }


    /*
       STEP 1

       Estimate actual blockchain gas.
    */

    const gasEstimate =
        await estimateUsdtTransferGas(
            network,
            fromAddress,
            toAddress,
            amount
        );


    /*
       STEP 2

       Get native token → USDT conversion price.
    */

    const nativeTokenPriceUsdt =
        getNativeTokenPriceUsdt(
            network
        );


    /*
       STEP 3

       Calculate actual gas cost in USDT.
    */

    const actualGasCostUsdt =
        gasEstimate.gasCostNative *
        nativeTokenPriceUsdt;


    /*
       STEP 4

       Calculate AVERYX internal margin.

       40% of actual gas cost.
    */

    const platformMarginUsdt =
        actualGasCostUsdt *
        PLATFORM_MARGIN_PERCENT;


    /*
       STEP 5

       Total fee deducted from the requested amount.
    */

    const totalFeeUsdt =
        actualGasCostUsdt +
        platformMarginUsdt;


    /*
       STEP 6

       Amount recipient receives.
    */

    const recipientAmount =
        amount -
        totalFeeUsdt;


    if (
        recipientAmount <= 0
    ) {

        throw new Error(
            "Withdrawal amount is too small to cover network costs."
        );

    }


    /*
       Round monetary values.

       We retain more precision internally during
       calculation, then round returned USDT values.
    */

    const roundUsdt =
        (value) => {

            return Number(
                value.toFixed(6)
            );

        };


    return {

        /*
           USER-SAFE DATA
        */

        network:
            String(network)
                .toUpperCase(),

        requestedAmount:
            roundUsdt(amount),

        recipientAmount:
            roundUsdt(
                recipientAmount
            ),


        /*
           INTERNAL DATA

           Do not expose these fields directly
           to the public frontend.
        */

        internal: {

            actualGasCostUsdt:
                roundUsdt(
                    actualGasCostUsdt
                ),

            platformMarginUsdt:
                roundUsdt(
                    platformMarginUsdt
                ),

            totalFeeUsdt:
                roundUsdt(
                    totalFeeUsdt
                ),

            gasLimit:
                gasEstimate.gasLimit.toString(),

            gasPrice:
                gasEstimate.gasPrice.toString(),

            gasCostNative:
                gasEstimate.gasCostNative,

            nativeSymbol:
                gasEstimate.nativeSymbol,

            nativeTokenPriceUsdt

        }

    };

}



/* ==================================================
   CREATE PUBLIC QUOTE

   This is what the frontend should receive.

   It intentionally hides:

   - actual gas cost
   - platform margin
   - total internal fee
================================================== */

function createPublicQuote(
    quote
) {

    return {

        network:
            quote.network,

        requestedAmount:
            quote.requestedAmount,

        recipientAmount:
            quote.recipientAmount

    };

}



/* ==================================================
   EXPORTS
================================================== */

module.exports = {

    createGasQuote,

    createPublicQuote,

    estimateUsdtTransferGas,

    getNativeTokenPriceUsdt,

    getNetworkConfig,

    PLATFORM_MARGIN_PERCENT

};