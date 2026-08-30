const express = require("express");

const {
    adminLogin,
    getAdminWithdrawals,
    getAdminWithdrawalById,
    completeAdminWithdrawal,
    failAdminWithdrawal,
    getAdminDeposits,
    getAdminDepositById,
    getAdminUsers,
    getAdminUserById
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

/* Protected admin deposit monitoring - read-only */
router.get(
    "/deposits",
    authenticateAdmin,
    getAdminDeposits
);

router.get(
    "/deposits/:id",
    authenticateAdmin,
    getAdminDepositById
);


/* Protected admin user monitoring - read-only */
router.get(
    "/users",
    authenticateAdmin,
    getAdminUsers
);

router.get(
    "/users/:id",
    authenticateAdmin,
    getAdminUserById
);


module.exports =
    router;
