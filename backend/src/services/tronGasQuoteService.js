const { TronWeb } = require("tronweb");

const TRON_API_URL = process.env.TRON_API_URL;
const TRC20_USDT_CONTRACT = process.env.TRC20_USDT_CONTRACT;
const TRC20_WITHDRAW_ADDRESS =
    process.env.TRC20_WITHDRAW_ADDRESS ||
    process.env.TRC20_DEPOSIT_ADDRESS;

const DEFAULT_MARGIN_PERCENT = 30;
const DEFAULT_BANDWIDTH_BYTES = 345;

const PRICE_CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_PRICE_AGE_MS = 15 * 60 * 1000;

let priceCache = null;
let priceInFlight = null;

function getTronWeb() {
    if (!TRON_API_URL) {
        throw new Error("TRON_API_URL is not configured.");
    }

    return new TronWeb({ fullHost: TRON_API_URL });
}

function getMarginPercent() {
    const configured = Number(process.env.TRC20_PLATFORM_MARGIN_PERCENT);

    return Number.isFinite(configured) && configured >= 0
        ? configured
        : DEFAULT_MARGIN_PERCENT;
}

function getSenderAddress() {
    if (!TRC20_WITHDRAW_ADDRESS) {
        throw new Error(
            "TRC20 withdrawal wallet address is not configured. Set TRC20_WITHDRAW_ADDRESS."
        );
    }

    if (!TronWeb.isAddress(TRC20_WITHDRAW_ADDRESS)) {
        throw new Error("TRC20 withdrawal wallet address is invalid.");
    }

    return TRC20_WITHDRAW_ADDRESS;
}

function getContractAddress() {
    if (!TRC20_USDT_CONTRACT) {
        throw new Error("TRC20_USDT_CONTRACT is not configured.");
    }

    if (!TronWeb.isAddress(TRC20_USDT_CONTRACT)) {
        throw new Error("TRC20_USDT_CONTRACT is invalid.");
    }

    return TRC20_USDT_CONTRACT;
}

function roundDownUsdt(value) {
    return Math.floor((Number(value) + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function getChainParameter(parameters, key, fallback = 0) {
    const row = (parameters || []).find((item) => item.key === key);
    const value = Number(row?.value);

    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function getTrxPriceUsdt() {
    const now = Date.now();

    if (priceCache && now - priceCache.fetchedAt < PRICE_CACHE_TTL_MS) {
        return { ...priceCache, cached: true, stale: false };
    }

    if (priceInFlight) {
        return await priceInFlight;
    }

    priceInFlight = (async () => {
        let kucoinError = null;

        try {
            const response = await fetch(
                "https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=TRX-USDT",
                {
                    headers: { accept: "application/json" },
                    signal: AbortSignal.timeout(10000)
                }
            );

            if (!response.ok) {
                throw new Error("KuCoin HTTP " + response.status);
            }

            const data = await response.json();
            const price = Number(data?.data?.price);

            if (String(data?.code) !== "200000" || !Number.isFinite(price) || price <= 0) {
                throw new Error("KuCoin returned an invalid TRX price.");
            }

            priceCache = {
                priceUsdt: price,
                source: "KuCoin",
                fetchedAt: Date.now(),
                cached: false,
                stale: false
            };

            return priceCache;
        } catch (error) {
            kucoinError = error;
        }

        try {
            const response = await fetch(
                "https://api.coingecko.com/api/v3/simple/price?ids=tron&vs_currencies=usd",
                {
                    headers: { accept: "application/json" },
                    signal: AbortSignal.timeout(10000)
                }
            );

            if (!response.ok) {
                throw new Error("CoinGecko HTTP " + response.status);
            }

            const data = await response.json();
            const price = Number(data?.tron?.usd);

            if (!Number.isFinite(price) || price <= 0) {
                throw new Error("CoinGecko returned an invalid TRX price.");
            }

            priceCache = {
                priceUsdt: price,
                source: "CoinGecko",
                fetchedAt: Date.now(),
                cached: false,
                stale: false,
                fallbackReason: "kucoin-failed: " + kucoinError.message
            };

            return priceCache;
        } catch (coinGeckoError) {
            if (priceCache && now - priceCache.fetchedAt < MAX_PRICE_AGE_MS) {
                return {
                    ...priceCache,
                    cached: true,
                    stale: true,
                    fallbackReason: "live-price-sources-failed"
                };
            }

            throw new Error(
                "Unable to fetch live TRX price. KuCoin: " +
                (kucoinError?.message || "unknown") +
                " | CoinGecko: " +
                coinGeckoError.message
            );
        }
    })();

    try {
        return await priceInFlight;
    } finally {
        priceInFlight = null;
    }
}

async function estimateTrc20TransferResources({ toAddress, requestedAmount }) {
    const tronWeb = getTronWeb();
    const senderAddress = getSenderAddress();
    const contractAddress = getContractAddress();

    if (!TronWeb.isAddress(toAddress)) {
        throw new Error("Invalid TRC20 recipient address.");
    }

    const amount = Number(requestedAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Invalid withdrawal amount.");
    }

    const amountSun = Math.floor(amount * 1_000_000).toString();

    const parameters = [
        { type: "address", value: toAddress },
        { type: "uint256", value: amountSun }
    ];

    const simulation = await tronWeb.transactionBuilder.triggerConstantContract(
        contractAddress,
        "transfer(address,uint256)",
        {},
        parameters,
        senderAddress
    );

    const result = simulation?.result;
    if (!result || result.result !== true) {
        throw new Error("Unable to simulate TRC20 USDT transfer.");
    }

    const energyUsed = Number(simulation.energy_used || 0);
    if (!Number.isFinite(energyUsed) || energyUsed < 0) {
        throw new Error("TRON returned an invalid energy estimate.");
    }

    const [resources, chainParameters] = await Promise.all([
        tronWeb.trx.getAccountResources(senderAddress),
        tronWeb.trx.getChainParameters()
    ]);

    const availableEnergy = Math.max(
        0,
        Number(resources?.EnergyLimit || 0) - Number(resources?.EnergyUsed || 0)
    );

    const availableBandwidth = Math.max(
        0,
        (Number(resources?.freeNetLimit || 0) - Number(resources?.freeNetUsed || 0)) +
        (Number(resources?.NetLimit || 0) - Number(resources?.NetUsed || 0))
    );

    const energyFeeSun = getChainParameter(chainParameters, "getEnergyFee", 0);
    const transactionFeeSun = getChainParameter(chainParameters, "getTransactionFee", 0);

    const paidEnergy = Math.max(0, energyUsed - availableEnergy);
    const paidBandwidth = Math.max(0, DEFAULT_BANDWIDTH_BYTES - availableBandwidth);

    const energyCostSun = paidEnergy * energyFeeSun;
    const bandwidthCostSun = paidBandwidth * transactionFeeSun;
    const totalCostSun = energyCostSun + bandwidthCostSun;

    return {
        senderAddress,
        energyUsed,
        availableEnergy,
        availableBandwidth,
        estimatedBandwidthBytes: DEFAULT_BANDWIDTH_BYTES,
        paidEnergy,
        paidBandwidth,
        energyFeeSun,
        transactionFeeSun,
        totalCostSun
    };
}

async function createTrc20GasQuote({ toAddress, requestedAmount }) {
    const [resourceEstimate, priceResult] = await Promise.all([
        estimateTrc20TransferResources({ toAddress, requestedAmount }),
        getTrxPriceUsdt()
    ]);

    const actualGasCostTrx = resourceEstimate.totalCostSun / 1_000_000;
    const actualGasCostUsdt = actualGasCostTrx * priceResult.priceUsdt;
    const marginPercent = getMarginPercent();
    const platformMarginUsdt = actualGasCostUsdt * (marginPercent / 100);
    const totalFeeUsdt = actualGasCostUsdt + platformMarginUsdt;
    const recipientAmount = Number(requestedAmount) - totalFeeUsdt;

    if (!Number.isFinite(recipientAmount) || recipientAmount <= 0) {
        throw new Error("Withdrawal amount is too small to cover live TRC20 network costs.");
    }

    return {
        publicQuote: {
            network: "TRC20",
            requestedAmount: roundDownUsdt(requestedAmount),
            recipientAmount: roundDownUsdt(recipientAmount)
        },
        internal: {
            actualGasCostUsdt: roundDownUsdt(actualGasCostUsdt),
            platformMarginUsdt: roundDownUsdt(platformMarginUsdt),
            totalFeeUsdt: roundDownUsdt(totalFeeUsdt),
            actualGasCostTrx,
            marginPercent,
            estimateSource: "live-tron-simulation",
            priceSource: priceResult.source,
            priceFetchedAt: new Date(priceResult.fetchedAt).toISOString(),
            priceCached: Boolean(priceResult.cached),
            priceStale: Boolean(priceResult.stale),
            senderAddress: resourceEstimate.senderAddress,
            resourceEstimate
        }
    };
}

module.exports = {
    createTrc20GasQuote,
    estimateTrc20TransferResources,
    getTrxPriceUsdt
};
