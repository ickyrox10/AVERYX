const express = require("express");

const {

    getWallet,

    createDeposit,

    createWithdrawal,

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