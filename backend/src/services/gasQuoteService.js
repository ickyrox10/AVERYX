const { ethers } = require("ethers");


/* ==================================================
   GAS QUOTE SERVICE
================================================== */

/*
   Margin percentages are expressed as human-readable
   percentages in ENV, then converted to decimal multipliers.

   Examples:
   3500 => 35.00 multiplier
   30   => 0.30 multiplier
*/

const DEFAULT_MARGIN_PERCENTAGES = {
    BEP20: 3500,
    POLYGON: 3500,
    ERC20: 3500
};


function getPlatformMarginPercent(network) {

    const normalizedNetwork =
        String(network || "")
            .trim()
            .toUpperCase();


    const envKeys = {
        BEP20: "BEP20_PLATFORM_MARGIN_PERCENT",
        POLYGON: "POLYGON_PLATFORM_MARGIN_PERCENT",
        ERC20: "ERC20_PLATFORM_MARGIN_PERCENT"
    };


    const envKey =
        envKeys[normalizedNetwork];


    const configuredValue =
        envKey
            ? Number(process.env[envKey])
            : NaN;


    if (
        Number.isFinite(configuredValue) &&
        configuredValue >= 0
    ) {

        return configuredValue;

    }


    return (
        DEFAULT_MARGIN_PERCENTAGES[normalizedNetwork] ||
        0
    );

}


function getPlatformMarginMultiplier(network) {

    return (
        getPlatformMarginPercent(network) /
        100
    );

}


/* Backward-compatible default export value. */
const PLATFORM_MARGIN_PERCENT =
    getPlatformMarginMultiplier("BEP20");


/*
   Price cache.

   We intentionally keep this short because crypto
   prices move continuously.
*/

const PRICE_CACHE_TTL_MS = 2 * 60 * 1000;

const MAX_PRICE_AGE_MS = 15 * 60 * 1000;


const priceCache = new Map();


/*
   Prevent multiple simultaneous withdrawal requests
   from fetching the same native-token price at once.
*/
const priceFetchInFlight = new Map();


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

            kucoinSymbol:
                "BNB-USDT"

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

            kucoinSymbol:
                "ETH-USDT"

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

            kucoinSymbol:
                "POL-USDT"

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
   FETCH KUCOIN FALLBACK PRICE

   Used when the primary price source is unavailable.
================================================== */

async function fetchKuCoinNativeTokenPriceUsdt(
    config
) {

    const symbol =
        config.kucoinSymbol;


    if (!symbol) {

        throw new Error(
            "KuCoin symbol is not configured for " +
            config.network
        );

    }


    /*
       Try the standard public endpoint first.

       A second official regional endpoint is attempted
       only if the first endpoint is unreachable.
    */

    const baseUrls = [
        "https://api.kucoin.com",
        "https://api.kucoin.eu"
    ];


    let lastError = null;


    for (
        const baseUrl of baseUrls
    ) {

        try {

            const url =
                baseUrl +
                "/api/v1/market/orderbook/level1?symbol=" +
                encodeURIComponent(
                    symbol
                );


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
                    baseUrl +
                    " HTTP " +
                    response.status
                );

            }


            const data =
                await response.json();


            if (
                String(data?.code) !==
                "200000"
            ) {

                throw new Error(
                    baseUrl +
                    " returned an unsuccessful response."
                );

            }


            const price =
                Number(
                    data?.data?.price
                );


            if (
                !Number.isFinite(
                    price
                ) ||
                price <= 0
            ) {

                throw new Error(
                    baseUrl +
                    " returned an invalid price."
                );

            }


            return {

                priceUsdt:
                    price,

                source:
                    "KuCoin",

                fetchedAt:
                    Date.now(),

                cached:
                    false,

                stale:
                    false

            };


        } catch (error) {

            lastError =
                error;

        }

    }


    throw new Error(
        "KuCoin price request failed: " +
        (
            lastError?.message ||
            "Unknown error"
        )
    );

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


    const cacheKey =
        config.coinGeckoId;


    const cached =
        priceCache.get(
            cacheKey
        );


    const now =
        Date.now();


    /*
       Fresh cache.

       One external quote can safely serve multiple
       withdrawal requests for a short period.
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
                false,

            fallbackReason:
                null

        };

    }


    /*
       If another request is already fetching this
       exact token price, wait for that request instead
       of creating another external API call.
    */

    const existingRequest =
        priceFetchInFlight.get(
            cacheKey
        );


    if (existingRequest) {

        return await existingRequest;

    }


    const fetchPromise =
        (async () => {

            const latestCached =
                priceCache.get(
                    cacheKey
                );


            const fetchStartedAt =
                Date.now();


            const canUseStaleCache =
                latestCached &&
                fetchStartedAt -
                latestCached.fetchedAt <
                MAX_PRICE_AGE_MS;


            const returnStaleCache =
                (reason) => {

                    if (!canUseStaleCache) {

                        return null;

                    }


                    return {

                        ...latestCached,

                        cached:
                            true,

                        stale:
                            true,

                        fallbackReason:
                            reason

                    };

                };


            /*
               SOURCE 1: KuCoin.

               We use KuCoin first because the deployed
               Render environment is already receiving
               CoinGecko HTTP 429 responses.
            */

            let kucoinError = null;


            try {

                const result =
                    await fetchKuCoinNativeTokenPriceUsdt(
                        config
                    );


                priceCache.set(
                    cacheKey,
                    result
                );


                return result;


            } catch (error) {

                kucoinError =
                    error;

            }


            /*
               SOURCE 2: CoinGecko.
            */

            let coinGeckoError = null;


            try {

                const url =
                    "https://api.coingecko.com/api/v3/simple/price" +
                    "?ids=" +
                    encodeURIComponent(
                        config.coinGeckoId
                    ) +
                    "&vs_currencies=usd";


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
                            config.coinGeckoId
                        ]?.usd
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


                const result = {

                    priceUsdt:
                        price,

                    source:
                        "CoinGecko",

                    fetchedAt:
                        Date.now(),

                    cached:
                        false,

                    stale:
                        false

                };


                priceCache.set(
                    cacheKey,
                    result
                );


                return {

                    ...result,

                    fallbackReason:
                        "kucoin-failed: " +
                        kucoinError.message

                };


            } catch (error) {

                coinGeckoError =
                    error;

            }


            /*
               FINAL FALLBACK:

               Never invent a price. Use only a recently
               fetched real market price.
            */

            const staleResult =
                returnStaleCache(
                    "kucoin-and-coingecko-failed"
                );


            if (staleResult) {

                return staleResult;

            }


            throw new Error(
                "Unable to fetch native token price. " +
                "KuCoin: " +
                kucoinError.message +
                " | CoinGecko: " +
                coinGeckoError.message
            );

        })();


    priceFetchInFlight.set(
        cacheKey,
        fetchPromise
    );


    try {

        return await fetchPromise;

    } finally {

        priceFetchInFlight.delete(
            cacheKey
        );

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
       Network-specific internal margin.

       BEP20: 3500% by default
       POLYGON: 3500% by default
       ERC20: 30% by default

       ENV values override these defaults.
    */

    const platformMarginUsdt =
        actualGasCostUsdt *
        getPlatformMarginMultiplier(
            config.network
        );


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
   VERIFY EVM USDT PAYMENT

   Used by manual admin approval.

   Verifies a completed USDT Transfer event against:
   - configured network USDT contract
   - expected recipient address
   - expected recipient amount

   Amount comparison allows a configurable tolerance
   because manual payments can differ slightly from the
   calculated quote due to real-world gas handling and
   decimal rounding.
================================================== */

async function verifyEvmUsdtPayment({

    network,

    txHash,

    expectedRecipientAddress,

    expectedAmountUsdt,

    toleranceUsdt = 0.10

}) {

    const normalizedNetwork =
        String(network || "")
            .trim()
            .toUpperCase();


    if (
        !txHash ||
        typeof txHash !== "string"
    ) {

        throw new Error(
            "Transaction hash is required."
        );

    }


    if (
        !ethers.isAddress(
            expectedRecipientAddress
        )
    ) {

        throw new Error(
            "Expected recipient address is invalid."
        );

    }


    const expectedAmount =
        Number(
            expectedAmountUsdt
        );


    const tolerance =
        Number(
            toleranceUsdt
        );


    if (
        !Number.isFinite(
            expectedAmount
        ) ||
        expectedAmount <= 0
    ) {

        throw new Error(
            "Expected payment amount is invalid."
        );

    }


    if (
        !Number.isFinite(
            tolerance
        ) ||
        tolerance < 0
    ) {

        throw new Error(
            "Payment tolerance is invalid."
        );

    }


    const config =
        getNetworkConfig(
            normalizedNetwork
        );


    const provider =
        getProvider(
            normalizedNetwork
        );


    let receipt;


    try {

        receipt =
            await provider.getTransactionReceipt(
                txHash.trim()
            );

    } catch (error) {

        throw new Error(
            "Unable to read transaction: " +
            error.message
        );

    }


    if (!receipt) {

        throw new Error(
            "Transaction was not found or is not yet confirmed."
        );

    }


    if (
        Number(receipt.status) !==
        1
    ) {

        throw new Error(
            "Transaction failed on-chain."
        );

    }


    const transferInterface =
        new ethers.Interface([
            "event Transfer(address indexed from, address indexed to, uint256 value)"
        ]);


    const expectedContract =
        config.usdtContract.toLowerCase();


    const expectedRecipient =
        expectedRecipientAddress.toLowerCase();


    let matchingTransfer =
        null;


    for (
        const log of receipt.logs || []
    ) {

        if (
            String(log.address || "")
                .toLowerCase() !==
            expectedContract
        ) {

            continue;

        }


        let parsed;


        try {

            parsed =
                transferInterface.parseLog(
                    log
                );

        } catch {

            continue;

        }


        if (
            !parsed ||
            parsed.name !==
            "Transfer"
        ) {

            continue;

        }


        const recipient =
            String(
                parsed.args.to
            ).toLowerCase();


        if (
            recipient !==
            expectedRecipient
        ) {

            continue;

        }


        const decimals =
            await getUsdtDecimals(
                provider,
                config.usdtContract
            );


        const actualAmount =
            Number(
                ethers.formatUnits(
                    parsed.args.value,
                    Number(decimals)
                )
            );


        const difference =
            Math.abs(
                actualAmount -
                expectedAmount
            );


        if (
            difference <=
            tolerance +
            1e-12
        ) {

            matchingTransfer = {

                actualAmountUsdt:
                    actualAmount,

                expectedAmountUsdt:
                    expectedAmount,

                toleranceUsdt:
                    tolerance,

                differenceUsdt:
                    difference,

                fromAddress:
                    parsed.args.from,

                toAddress:
                    parsed.args.to

            };

            break;

        }

    }


    if (!matchingTransfer) {

        throw new Error(
            "No matching USDT transfer was found for the expected recipient and amount tolerance."
        );

    }


    return {

        verified:
            true,

        network:
            normalizedNetwork,

        txHash:
            txHash.trim(),

        usdtContract:
            config.usdtContract,

        ...matchingTransfer

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

    fetchKuCoinNativeTokenPriceUsdt,

    getNetworkConfig,

    getProvider,

    PLATFORM_MARGIN_PERCENT,

    getPlatformMarginPercent,

    getPlatformMarginMultiplier,

    verifyEvmUsdtPayment

};