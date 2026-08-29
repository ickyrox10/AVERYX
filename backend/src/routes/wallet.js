const express = require("express");

const {

    getWallet,

    createDeposit,

    createWithdrawal,

    getWithdrawalQuote,

    getTransactions

} = require("../controllers/walletController");


const {

    authenticateToken

} = require("../middleware/authMiddleware");


const router =
    express.Router();


/* ==================================================
   GET WALLET
================================================== */

router.get(

    "/",

    authenticateToken,

    getWallet

);


/* ==================================================
   CREATE DEPOSIT
================================================== */

router.post(

    "/deposit",

    authenticateToken,

    createDeposit

);


/* ==================================================
   GET WITHDRAWAL QUOTE
================================================== */

router.post(

    "/withdraw/quote",

    authenticateToken,

    getWithdrawalQuote

);


/* ==================================================
   CREATE WITHDRAWAL
================================================== */

router.post(

    "/withdraw",

    authenticateToken,

    createWithdrawal

);


/* ==================================================
   GET TRANSACTIONS
================================================== */

router.get(

    "/transactions",

    authenticateToken,

    getTransactions

);


/* ==================================================
   EXPORT
================================================== */

module.exports =
    router;