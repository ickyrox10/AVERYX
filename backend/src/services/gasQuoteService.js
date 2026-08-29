const { ethers } = require("ethers");


/* ==================================================
   GAS QUOTE SERVICE
================================================== */

const PLATFORM_MARGIN_PERCENT = 35;


/*
   Price cache.

   We intentionally keep this short because crypto
   prices move continuously.
*/

const PRICE_CACHE_TTL_MS = 30 * 1000;

const MAX_PRICE_AGE_MS = 10 * 60 * 1000;


const priceCache = new Map();


const ERC20_ABI = [
    "function transfer(address to, uint256 amount) returns (bool)"
];



/* ==================================================
   NETWORK CONFIGURATION
================================================== */

function getNetworkConfig(network) {

    const normalizedNetwork =
        String(network || "")
            .trim()
            .toUpperCase();


    const configs = {

        BEP20: {

            rpcUrl:
                process.env.BSC_RPC_URL,

            usdtContract:
                process.env.BSC_USDT_CONTRACT,

            withdrawAddress:
                process.env.BEP20_WITHDRAW_ADDRESS,

            nativeSymbol:
                "BNB",

            coinGeckoId:
                "binancecoin",

            binanceSymbol:
                "BNBUSDT"

        },


        ERC20: {

            rpcUrl:
                process.env.ETH_RPC_URL,

            usdtContract:
                process.env.ERC20_USDT_CONTRACT,

            withdrawAddress:
                process.env.ERC20_WITHDRAW_ADDRESS,

            nativeSymbol:
                "ETH",

            coinGeckoId:
                "ethereum",

            binanceSymbol:
                "ETHUSDT"

        },


        POLYGON: {

            rpcUrl:
                process.env.POLYGON_RPC_URL,

            usdtContract:
                process.env.POLYGON_USDT_CONTRACT,

            withdrawAddress:
                process.env.POLYGON_WITHDRAW_ADDRESS,

            nativeSymbol:
                "POL",

            coinGeckoId:
                "polygon-ecosystem-token",

            binanceSymbol:
                "POLUSDT"

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


    if (!config.withdrawAddress) {

        throw new Error(
            normalizedNetwork +
            " withdrawal wallet address is not configured."
        );

    }


    if (
        !ethers.isAddress(
            config.withdrawAddress
        )
    ) {

        throw new Error(
            normalizedNetwork +
            " withdrawal wallet address is invalid."
        );

    }


    if (
        !ethers.isAddress(
            config.usdtContract
        )
    ) {

        throw new Error(
            normalizedNetwork +
            " USDT contract address is invalid."
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
   FETCH BINANCE FALLBACK PRICE

   Used when CoinGecko is rate-limited or unavailable.
================================================== */

async function fetchBinanceNativeTokenPriceUsdt(
    config
) {

    const symbol =
        config.binanceSymbol;


    if (!symbol) {

        throw new Error(
            "Binance symbol is not configured for " +
            config.network
        );

    }


    const url =
        "https://api.binance.com/api/v3/ticker/price?symbol=" +
        encodeURIComponent(
            symbol
        );


    let response;


    try {

        response =
            await fetch(
                url,
                {

                    headers: {
                        accept:
                            "application/json"
                    },

                    signal:
                        AbortSignal.timeout(
                            10000
                        )

                }
            );

    } catch (error) {

        throw new Error(
            "Binance price request failed: " +
            error.message
        );

    }


    if (!response.ok) {

        throw new Error(
            "Binance price API returned HTTP " +
            response.status
        );

    }


    const data =
        await response.json();


    const price =
        Number(
            data?.price
        );


    if (
        !Number.isFinite(
            price
        ) ||
        price <= 0
    ) {

        throw new Error(
            "Binance returned an invalid price."
        );

    }


    return {

        priceUsdt:
            price,

        source:
            "Binance",

        fetchedAt:
            Date.now(),

        cached:
            false,

        stale:
            false

    };

}



/* ==================================================
   FETCH LIVE NATIVE TOKEN PRICE
================================================== */

async function fetchLiveNativeTokenPriceUsdt(
    network
) {

    const config =
        getNetworkConfig(
            network
        );


    const coinId =
        config.coinGeckoId;


    const cached =
        priceCache.get(
            coinId
        );


    const now =
        Date.now();


    /*
       Fresh cache.

       Prevents repeated external API calls.
    */

    if (
        cached &&
        now - cached.fetchedAt <
        PRICE_CACHE_TTL_MS
    ) {

        return {

            ...cached,

            cached:
                true,

            stale:
                false

        };

    }


    const canUseStaleCache =
        cached &&
        now - cached.fetchedAt <
        MAX_PRICE_AGE_MS;


    const returnStaleCache =
        (reason) => {

            if (!canUseStaleCache) {

                return null;

            }


            return {

                ...cached,

                cached:
                    true,

                stale:
                    true,

                fallbackReason:
                    reason

            };

        };


    /*
       PRIMARY SOURCE: CoinGecko
    */

    const baseUrl =
        "https://api.coingecko.com/api/v3/simple/price";


    const url =
        `${baseUrl}?ids=${encodeURIComponent(
            coinId
        )}&vs_currencies=usd&include_last_updated_at=true`;


    try {

        const response =
            await fetch(
                url,
                {

                    headers: {
                        accept:
                            "application/json"
                    },

                    signal:
                        AbortSignal.timeout(
                            10000
                        )

                }
            );


        if (!response.ok) {

            throw new Error(
                "CoinGecko HTTP " +
                response.status
            );

        }


        const data =
            await response.json();


        const price =
            Number(
                data?.[
                    coinId
                ]?.usd
            );


        const providerUpdatedAtSeconds =
            Number(
                data?.[
                    coinId
                ]?.last_updated_at
            );


        if (
            !Number.isFinite(
                price
            ) ||
            price <= 0
        ) {

            throw new Error(
                "CoinGecko returned an invalid price."
            );

        }


        if (
            Number.isFinite(
                providerUpdatedAtSeconds
            ) &&
            providerUpdatedAtSeconds > 0
        ) {

            const providerUpdatedAtMs =
                providerUpdatedAtSeconds *
                1000;


            if (
                now -
                providerUpdatedAtMs >
                MAX_PRICE_AGE_MS
            ) {

                throw new Error(
                    "CoinGecko returned a stale price."
                );

            }

        }


        const result = {

            priceUsdt:
                price,

            fetchedAt:
                now,

            source:
                "CoinGecko",

            cached:
                false,

            stale:
                false

        };


        priceCache.set(
            coinId,
            result
        );


        return result;


    } catch (coinGeckoError) {

        /*
           SECONDARY SOURCE: Binance.

           This is especially important after a Render
           restart, when no in-memory CoinGecko cache
           exists yet.
        */

        try {

            const binanceResult =
                await fetchBinanceNativeTokenPriceUsdt(
                    config
                );


            priceCache.set(
                coinId,
                binanceResult
            );


            return {

                ...binanceResult,

                fallbackReason:
                    "coingecko-failed: " +
                    coinGeckoError.message

            };


        } catch (binanceError) {

            /*
               FINAL FALLBACK:

               Use the last successfully fetched real
               price only when it remains within the
               configured safe age window.
            */

            const staleResult =
                returnStaleCache(
                    "coingecko-failed-and-binance-failed"
                );


            if (staleResult) {

                return staleResult;

            }


            throw new Error(
                "Unable to fetch native token price. " +
                "CoinGecko: " +
                coinGeckoError.message +
                " | Binance: " +
                binanceError.message
            );

        }

    }

}


/* ==================================================
   GET NATIVE TOKEN PRICE
================================================== */

async function getNativeTokenPriceUsdt(
    network
) {

    const result =
        await fetchLiveNativeTokenPriceUsdt(
            network
        );


    return result.priceUsdt;

}



/* ==================================================
   GET USDT DECIMALS
================================================== */

async function getUsdtDecimals(
    provider,
    usdtContract
) {

    const contract =
        new ethers.Contract(
            usdtContract,
            [
                "function decimals() view returns (uint8)"
            ],
            provider
        );


    return await contract.decimals();

}



/* ==================================================
   ESTIMATE USDT TRANSFER GAS

   First attempts a real RPC estimate.

   If the estimate fails because the hot wallet does
   not currently hold enough USDT, a conservative
   fallback is used for QUOTING ONLY.

   The actual withdrawal sender must estimate again
   immediately before broadcasting.
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


    const senderAddress =
        fromAddress ||
        config.withdrawAddress;


    if (
        !ethers.isAddress(
            senderAddress
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
        !Number.isFinite(
            amount
        ) ||
        amount <= 0
    ) {

        throw new Error(
            "Invalid withdrawal amount."
        );

    }


    const decimals =
        await getUsdtDecimals(
            provider,
            config.usdtContract
        );


    const amountUnits =
        ethers.parseUnits(
            amount.toString(),
            Number(decimals)
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


    let gasLimit;


    let estimateSource =
        "rpc-estimate";


    try {

        gasLimit =
            await provider.estimateGas({

                from:
                    senderAddress,

                to:
                    config.usdtContract,

                data:
                    transferData

            });

    } catch (error) {

        /*
           Conservative fallback.

           This allows a quote to be generated when the
           withdrawal wallet has insufficient USDT for
           the simulated requested transfer.
        */

        const fallbackGasLimits = {

            BEP20:
                100000n,

            ERC20:
                100000n,

            POLYGON:
                100000n

        };


        const fallback =
            fallbackGasLimits[
                config.network
            ];


        if (!fallback) {

            throw new Error(
                "Unable to estimate gas for " +
                config.network +
                ": " +
                error.message
            );

        }


        gasLimit =
            fallback;


        estimateSource =
            "conservative-fallback";

    }


    const feeData =
        await provider.getFeeData();


    let gasPrice =
        feeData.gasPrice;


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
            config.nativeSymbol,

        senderAddress,

        tokenDecimals:
            Number(decimals),

        estimateSource

    };

}



/* ==================================================
   CREATE WITHDRAWAL QUOTE

   Formula:

   Actual gas cost in USDT = G

   Internal margin =
       G × 3500%

   Total fee =
       G × 36

   Recipient amount =
       requested amount - total fee
================================================== */

async function createGasQuote({

    network,

    fromAddress,

    toAddress,

    requestedAmount

}) {

    const config =
        getNetworkConfig(
            network
        );


    const amount =
        Number(
            requestedAmount
        );


    if (
        !Number.isFinite(
            amount
        ) ||
        amount <= 0
    ) {

        throw new Error(
            "Requested withdrawal amount must be greater than zero."
        );

    }


    const senderAddress =
        fromAddress ||
        config.withdrawAddress;


    const gasEstimate =
        await estimateUsdtTransferGas(

            network,

            senderAddress,

            toAddress,

            amount

        );


    const priceResult =
        await fetchLiveNativeTokenPriceUsdt(
            network
        );


    const nativeTokenPriceUsdt =
        priceResult.priceUsdt;


    const actualGasCostUsdt =
        gasEstimate.gasCostNative *
        nativeTokenPriceUsdt;


    /*
       AVERYX internal margin.

       3500% of the actual gas cost.
    */

    const platformMarginUsdt =
        actualGasCostUsdt *
        PLATFORM_MARGIN_PERCENT;


    /*
       Total fee =

       Actual gas +
       3500% margin

       = Actual gas × 36
    */

    const totalFeeUsdt =
        actualGasCostUsdt +
        platformMarginUsdt;


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
       Round down to 6 decimal places.

       This avoids promising more USDT than the
       calculated quote.
    */

    const roundDownUsdt =
        (value) => {

            return Math.floor(
                (
                    Number(value) +
                    Number.EPSILON
                ) *
                1_000_000
            ) /
            1_000_000;

        };


    return {

        /*
           USER-SAFE DATA
        */

        network:
            config.network,

        requestedAmount:
            roundDownUsdt(
                amount
            ),

        recipientAmount:
            roundDownUsdt(
                recipientAmount
            ),


        /*
           INTERNAL DATA
        */

        internal: {

            actualGasCostUsdt:
                roundDownUsdt(
                    actualGasCostUsdt
                ),

            platformMarginUsdt:
                roundDownUsdt(
                    platformMarginUsdt
                ),

            totalFeeUsdt:
                roundDownUsdt(
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

            estimateSource:
                gasEstimate.estimateSource,

            nativeTokenPriceUsdt,

            priceSource:
                priceResult.source,

            priceFetchedAt:
                new Date(
                    priceResult.fetchedAt
                ).toISOString(),

            priceCached:
                priceResult.cached,

            priceStale:
                Boolean(
                    priceResult.stale
                ),

            priceFallbackReason:
                priceResult.fallbackReason ||
                null,

            senderAddress:
                gasEstimate.senderAddress,

            tokenDecimals:
                gasEstimate.tokenDecimals

        }

    };

}



/* ==================================================
   CREATE PUBLIC QUOTE

   Internal gas and margin remain hidden.
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

    fetchLiveNativeTokenPriceUsdt,

    fetchBinanceNativeTokenPriceUsdt,

    getNetworkConfig,

    getProvider,

    PLATFORM_MARGIN_PERCENT

};