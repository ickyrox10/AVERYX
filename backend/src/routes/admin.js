const express = require("express");

const {
    adminLogin,
    getAdminWithdrawals,
    getAdminWithdrawalById,
    completeAdminWithdrawal,
    failAdminWithdrawal
} = require("../controllers/adminController");

const {
    authenticateAdmin
} = require("../middleware/adminMiddleware");


const router =
    express.Router();


/* Public admin login */
router.post(
    "/login",
    adminLogin
);


/* Protected admin withdrawal management */
router.get(
    "/withdrawals",
    authenticateAdmin,
    getAdminWithdrawals
);


router.get(
    "/withdrawals/:id",
    authenticateAdmin,
    getAdminWithdrawalById
);


router.patch(
    "/withdrawals/:id/complete",
    authenticateAdmin,
    completeAdminWithdrawal
);


router.patch(
    "/withdrawals/:id/fail",
    authenticateAdmin,
    failAdminWithdrawal
);


module.exports =
    router;
