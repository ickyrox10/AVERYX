const express = require("express");

const {
    getReferralStats
} = require("../controllers/walletController");

const {
    authenticateToken
} = require("../middleware/authMiddleware");


const router =
    express.Router();


/* ==================================================
   GET REFERRAL STATISTICS
================================================== */

router.get(

    "/",

    authenticateToken,

    getReferralStats

);


/* ==================================================
   EXPORT
================================================== */

module.exports =
    router;