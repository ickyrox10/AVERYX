const { ethers } = require("ethers");
const {
    getNetworkConfig,
    getProvider
} = require("./gasQuoteService");

/* ==================================================
   CONFIG
================================================== */

const GAS_FUNDING_ENABLED =
    String(process.env.GAS_FUNDING_ENABLED || "false").toLowerCase() === "true";

const GAS_TREASURY_PRIVATE_KEY =
    process.env.GAS_TREASURY_PRIVATE_KEY;

const GAS_FUNDING_BUFFER_PERCENT = Number(
    process.env.GAS_FUNDING_BUFFER_PERCENT || 10
);

/*
    Maximum number of times we wait/check after
    sending native gas from the treasury.
*/
const GAS_FUNDING_CONFIRMATION_RETRIES = Number(
    process.env.GAS_FUNDING_CONFIRMATION_RETRIES || 3
);

const GAS_FUNDING_RETRY_DELAY_MS = Number(
    process.env.GAS_FUNDING_RETRY_DELAY_MS || 2000
);


/* ==================================================
   NETWORK CONFIGURATION

   Single source of truth: gasQuoteService.js
================================================== */


/* ==================================================
   HELPERS
================================================== */

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}


function normalizeNetwork(network) {
    const value = String(network || "")
        .trim()
        .toUpperCase();

    const aliases = {
        BSC: "BEP20",
        BEP20: "BEP20",

        ETH: "ERC20",
        ETHEREUM: "ERC20",
        ERC20: "ERC20",

        POLYGON: "POLYGON",
        MATIC: "POLYGON",
        POL: "POLYGON"
    };

    return aliases[value] || value;
}


function getBufferPercent() {
    if (
        !Number.isFinite(GAS_FUNDING_BUFFER_PERCENT) ||
        GAS_FUNDING_BUFFER_PERCENT < 0
    ) {
        return 0;
    }

    return GAS_FUNDING_BUFFER_PERCENT;
}


function validateAddress(address, label = "address") {
    if (!address || !ethers.isAddress(address)) {
        throw new Error(`Invalid ${label}.`);
    }

    return ethers.getAddress(address);
}


function getTreasuryPrivateKey() {
    const privateKey = String(
        GAS_TREASURY_PRIVATE_KEY || ""
    ).trim();

    if (!privateKey) {
        throw new Error(
            "GAS_TREASURY_PRIVATE_KEY is not configured."
        );
    }

    return privateKey;
}


function bigintMax(a, b) {
    return a > b ? a : b;
}


/*
    Adds a percentage buffer using integer arithmetic.

    Example:
    amount = 100
    buffer = 10%

    result = 110
*/
function addBuffer(amountWei, bufferPercent) {
    if (amountWei <= 0n) {
        return 0n;
    }

    if (!bufferPercent || bufferPercent <= 0) {
        return amountWei;
    }

    /*
        Use basis-style integer scaling to avoid
        floating point conversion problems.

        Example:
        10% => multiply by 11000 / 10000
    */

    const basisPoints = BigInt(
        Math.round(bufferPercent * 100)
    );

    const BASE = 10000n;

    return (
        amountWei *
        (BASE + basisPoints) +
        BASE -
        1n
    ) / BASE;
}


/* ==================================================
   PROVIDER / TREASURY
================================================== */

function createTreasuryWallet(network) {
    const normalizedNetwork = normalizeNetwork(network);
    const provider = getProvider(normalizedNetwork);
    const privateKey = getTreasuryPrivateKey();
    const wallet = new ethers.Wallet(privateKey, provider);

    return {
        provider,
        wallet
    };
}


/* ==================================================
   BALANCE CHECK
================================================== */

async function getNativeBalance({
    network,
    address
}) {
    const normalizedNetwork = normalizeNetwork(network);

    const validAddress = validateAddress(
        address,
        "wallet address"
    );

    const provider = getProvider(
        normalizedNetwork
    );

    const balanceWei =
        await provider.getBalance(validAddress);

    const config = getNetworkConfig(
        normalizedNetwork
    );

    return {
        network: normalizedNetwork,
        address: validAddress,
        nativeSymbol: config.nativeSymbol,
        balanceWei,
        balance: ethers.formatEther(balanceWei)
    };
}


/* ==================================================
   CALCULATE FUNDING REQUIREMENT
================================================== */

/*
    requiredGasWei:
    The amount of native token estimated for the
    upcoming USDT transfer.

    currentBalanceWei:
    Native balance currently available in the
    withdrawal hot wallet.

    We calculate:

    target balance =
        required gas
        + configurable safety buffer

    amount to fund =
        target balance
        - current balance

    If current balance is already enough,
    fundingRequired = false.
*/

function calculateGasFundingRequirement({
    requiredGasWei,
    currentBalanceWei,
    bufferPercent = getBufferPercent()
}) {
    const required = BigInt(requiredGasWei);
    const current = BigInt(currentBalanceWei);

    if (required < 0n) {
        throw new Error(
            "requiredGasWei cannot be negative."
        );
    }

    if (current < 0n) {
        throw new Error(
            "currentBalanceWei cannot be negative."
        );
    }

    const targetBalanceWei = addBuffer(
        required,
        bufferPercent
    );

    const shortageWei = bigintMax(
        targetBalanceWei - current,
        0n
    );

    return {
        requiredGasWei: required,
        currentBalanceWei: current,
        targetBalanceWei,
        amountToFundWei: shortageWei,
        fundingRequired: shortageWei > 0n,
        bufferPercent
    };
}


/* ==================================================
   TREASURY BALANCE SAFETY CHECK
================================================== */

async function ensureTreasuryHasFunds({
    network,
    requiredAmountWei
}) {
    const {
        wallet
    } = createTreasuryWallet(network);

    const config = getNetworkConfig(network);

    const treasuryBalanceWei =
        await wallet.provider.getBalance(
            wallet.address
        );

    const required = BigInt(requiredAmountWei);

    /*
        Treasury itself needs gas to send the
        native-token top-up.

        We don't try to estimate a precise amount here,
        because getBalance being merely >= amountToFund
        can still cause the treasury transaction to fail.

        We estimate the treasury transfer first.
    */

    const feeData =
        await wallet.provider.getFeeData();

    let gasPrice = feeData.gasPrice;

    if (!gasPrice || gasPrice <= 0n) {
        gasPrice = feeData.maxFeePerGas;
    }

    if (!gasPrice || gasPrice <= 0n) {
        throw new Error(
            `${config.network} treasury gas price could not be determined.`
        );
    }

    /*
        Native token transfer normally uses 21,000 gas.
        We use estimateGas below as the primary value.
    */

    let treasuryTransferGasLimit;

    try {
        treasuryTransferGasLimit =
            await wallet.provider.estimateGas({
                from: wallet.address,
                to: wallet.address,
                value: 0n
            });

        /*
            Self-transfer estimate isn't useful on every
            RPC/provider. Fall back below if needed.
        */

        if (
            !treasuryTransferGasLimit ||
            treasuryTransferGasLimit <= 0n
        ) {
            treasuryTransferGasLimit = 21000n;
        }
    } catch (error) {
        treasuryTransferGasLimit = 21000n;
    }

    /*
        Add a small 20% internal safety allowance
        for the treasury's own gas calculation.
    */

    const treasuryGasReserveWei =
        addBuffer(
            treasuryTransferGasLimit * gasPrice,
            20
        );

    const minimumRequiredWei =
        required +
        treasuryGasReserveWei;

    if (treasuryBalanceWei < minimumRequiredWei) {
        throw new Error(
            `${config.network} gas treasury has insufficient ` +
            `${config.nativeSymbol}. ` +
            `Treasury balance: ${ethers.formatEther(treasuryBalanceWei)} ${config.nativeSymbol}. ` +
            `Required for funding plus treasury transaction gas: ` +
            `${ethers.formatEther(minimumRequiredWei)} ${config.nativeSymbol}.`
        );
    }

    return {
        treasuryAddress: wallet.address,
        treasuryBalanceWei,
        treasuryGasReserveWei,
        minimumRequiredWei
    };
}


/* ==================================================
   SEND NATIVE GAS FROM TREASURY
================================================== */

async function fundWithdrawalWallet({
    network,
    toAddress,
    amountWei
}) {
    if (!GAS_FUNDING_ENABLED) {
        throw new Error(
            "Automatic gas funding is disabled. " +
            "Set GAS_FUNDING_ENABLED=true to enable it."
        );
    }

    const normalizedNetwork =
        normalizeNetwork(network);

    const config =
        getNetworkConfig(normalizedNetwork);

    const recipientAddress =
        validateAddress(
            toAddress,
            "withdrawal wallet address"
        );

    const fundingAmountWei =
        BigInt(amountWei);

    if (fundingAmountWei <= 0n) {
        return {
            funded: false,
            reason: "No funding required.",
            network: normalizedNetwork,
            nativeSymbol: config.nativeSymbol,
            amountWei: 0n,
            amount: "0"
        };
    }

    const {
        provider,
        wallet: treasuryWallet
    } = createTreasuryWallet(
        normalizedNetwork
    );

    const treasuryCheck =
        await ensureTreasuryHasFunds({
            network: normalizedNetwork,
            requiredAmountWei: fundingAmountWei
        });

    /*
        Get current fee data.
    */

    const feeData =
        await provider.getFeeData();

    const txRequest = {
        to: recipientAddress,
        value: fundingAmountWei
    };

    /*
        EIP-1559 networks.
    */

    if (
        feeData.maxFeePerGas &&
        feeData.maxPriorityFeePerGas
    ) {
        txRequest.maxFeePerGas =
            feeData.maxFeePerGas;

        txRequest.maxPriorityFeePerGas =
            feeData.maxPriorityFeePerGas;
    } else if (
        feeData.gasPrice
    ) {
        txRequest.gasPrice =
            feeData.gasPrice;
    }

    /*
        Estimate the actual native funding transaction.
    */

    try {
        const estimatedGas =
            await provider.estimateGas({
                from: treasuryWallet.address,
                to: recipientAddress,
                value: fundingAmountWei
            });

        /*
            Small safety buffer for treasury transfer gas.
        */

        txRequest.gasLimit =
            addBuffer(estimatedGas, 20);
    } catch (error) {
        /*
            Standard native transfer fallback.
        */

        txRequest.gasLimit = 21000n;
    }

    console.log(
        `[GasFunding] Funding ${normalizedNetwork} withdrawal wallet.`
    );

    console.log({
        network: normalizedNetwork,
        nativeSymbol: config.nativeSymbol,
        treasuryAddress: treasuryWallet.address,
        recipientAddress,
        amount: ethers.formatEther(
            fundingAmountWei
        )
    });

    const transaction =
        await treasuryWallet.sendTransaction(
            txRequest
        );

    console.log(
        `[GasFunding] Funding transaction broadcast: ${transaction.hash}`
    );

    const receipt =
        await transaction.wait(1);

    if (!receipt) {
        throw new Error(
            "Gas funding transaction did not return a receipt."
        );
    }

    if (
        receipt.status !== 1
    ) {
        throw new Error(
            "Gas funding transaction failed on-chain."
        );
    }

    return {
        funded: true,
        network: normalizedNetwork,
        nativeSymbol: config.nativeSymbol,
        treasuryAddress:
            treasuryCheck.treasuryAddress,
        recipientAddress,
        amountWei: fundingAmountWei,
        amount: ethers.formatEther(
            fundingAmountWei
        ),
        txHash: transaction.hash,
        receipt
    };
}


/* ==================================================
   WAIT AND RE-CHECK BALANCE
================================================== */

async function waitForRequiredGasBalance({
    network,
    address,
    requiredBalanceWei
}) {
    const normalizedNetwork =
        normalizeNetwork(network);

    const required =
        BigInt(requiredBalanceWei);

    const retries =
        Math.max(
            1,
            GAS_FUNDING_CONFIRMATION_RETRIES
        );

    for (
        let attempt = 1;
        attempt <= retries;
        attempt++
    ) {
        const balanceInfo =
            await getNativeBalance({
                network: normalizedNetwork,
                address
            });

        if (
            balanceInfo.balanceWei >= required
        ) {
            return {
                sufficient: true,
                attempt,
                ...balanceInfo
            };
        }

        if (
            attempt < retries
        ) {
            await sleep(
                GAS_FUNDING_RETRY_DELAY_MS
            );
        }
    }

    const finalBalance =
        await getNativeBalance({
            network: normalizedNetwork,
            address
        });

    return {
        sufficient:
            finalBalance.balanceWei >= required,
        attempt: retries,
        ...finalBalance
    };
}


/* ==================================================
   MAIN FUNCTION

   This is what withdrawalWorker.js will call.
================================================== */

/*
    Example:

    const result = await ensureGasForWithdrawal({
        network: "BEP20",
        withdrawalWalletAddress: senderAddress,
        requiredGasWei: gasCostNativeWei
    });

*/

async function ensureGasForWithdrawal({
    network,
    withdrawalWalletAddress,
    requiredGasWei
}) {
    if (!GAS_FUNDING_ENABLED) {
        throw new Error(
            "Automatic gas funding is disabled."
        );
    }

    const normalizedNetwork =
        normalizeNetwork(network);

    const config =
        getNetworkConfig(
            normalizedNetwork
        );

    /*
        TRC20 intentionally not supported here.
    */

    if (
        !["BEP20", "ERC20", "POLYGON"]
            .includes(normalizedNetwork)
    ) {
        throw new Error(
            `Automatic gas funding is unavailable for ${normalizedNetwork}.`
        );
    }

    const walletAddress =
        validateAddress(
            withdrawalWalletAddress,
            "withdrawal wallet address"
        );

    const required =
        BigInt(requiredGasWei);

    if (required <= 0n) {
        return {
            network: normalizedNetwork,
            nativeSymbol:
                config.nativeSymbol,
            fundingRequired: false,
            funded: false,
            reason:
                "Required gas is zero."
        };
    }

    /*
        STEP 1:
        Check current withdrawal wallet balance.
    */

    const currentBalance =
        await getNativeBalance({
            network: normalizedNetwork,
            address: walletAddress
        });

    /*
        STEP 2:
        Calculate exact shortage + buffer.
    */

    const requirement =
        calculateGasFundingRequirement({
            requiredGasWei: required,
            currentBalanceWei:
                currentBalance.balanceWei
        });

    /*
        Already enough gas.
    */

    if (!requirement.fundingRequired) {
        console.log(
            `[GasFunding] ${normalizedNetwork} withdrawal wallet already has sufficient ${config.nativeSymbol}.`
        );

        return {
            network: normalizedNetwork,
            nativeSymbol:
                config.nativeSymbol,
            withdrawalWalletAddress:
                walletAddress,

            fundingRequired: false,
            funded: false,

            currentBalanceWei:
                currentBalance.balanceWei,

            requiredGasWei:
                requirement.requiredGasWei,

            targetBalanceWei:
                requirement.targetBalanceWei,

            amountToFundWei: 0n,

            currentBalance:
                ethers.formatEther(
                    currentBalance.balanceWei
                ),

            requiredGas:
                ethers.formatEther(
                    requirement.requiredGasWei
                )
        };
    }

    /*
        STEP 3:
        Fund only the shortage + configured buffer.
    */

    const fundingResult =
        await fundWithdrawalWallet({
            network: normalizedNetwork,
            toAddress: walletAddress,
            amountWei:
                requirement.amountToFundWei
        });

    /*
        STEP 4:
        Re-check that enough gas now exists.
    */

    const balanceAfterFunding =
        await waitForRequiredGasBalance({
            network: normalizedNetwork,
            address: walletAddress,

            /*
                We require at least the actual gas
                estimated for the USDT transaction.
            */

            requiredBalanceWei:
                requirement.requiredGasWei
        });

    if (
        !balanceAfterFunding.sufficient
    ) {
        throw new Error(
            `${normalizedNetwork} withdrawal wallet still does not have enough ` +
            `${config.nativeSymbol} after automatic gas funding. ` +
            `Required: ${ethers.formatEther(requirement.requiredGasWei)} ${config.nativeSymbol}. ` +
            `Current: ${balanceAfterFunding.balance} ${config.nativeSymbol}.`
        );
    }

    return {
        network: normalizedNetwork,

        nativeSymbol:
            config.nativeSymbol,

        withdrawalWalletAddress:
            walletAddress,

        fundingRequired: true,

        funded:
            fundingResult.funded,

        requiredGasWei:
            requirement.requiredGasWei,

        currentBalanceBeforeWei:
            currentBalance.balanceWei,

        targetBalanceWei:
            requirement.targetBalanceWei,

        amountFundedWei:
            requirement.amountToFundWei,

        currentBalanceAfterWei:
            balanceAfterFunding.balanceWei,

        requiredGas:
            ethers.formatEther(
                requirement.requiredGasWei
            ),

        amountFunded:
            ethers.formatEther(
                requirement.amountToFundWei
            ),

        currentBalanceBefore:
            ethers.formatEther(
                currentBalance.balanceWei
            ),

        currentBalanceAfter:
            ethers.formatEther(
                balanceAfterFunding.balanceWei
            ),

        fundingTxHash:
            fundingResult.txHash,

        fundingReceipt:
            fundingResult.receipt
    };
}


/* ==================================================
   EXPORTS
================================================== */

module.exports = {
    normalizeNetwork,
    getNetworkConfig,
    getNativeBalance,

    calculateGasFundingRequirement,

    fundWithdrawalWallet,

    waitForRequiredGasBalance,

    ensureGasForWithdrawal
};