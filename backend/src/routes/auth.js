const express = require("express");

const {

    register,

    login,

    changePassword,

    requestPasswordReset,

    verifyPasswordReset,

    resetPassword,

    getMe,

    updateProfile

} = require("../controllers/authController");

const {

    authenticateToken

} = require("../middleware/authMiddleware");


const router =

    express.Router();


/* ==================================================
   REGISTER
================================================== */

router.post(

    "/register",

    register

);


/* ==================================================
   LOGIN
================================================== */

router.post(

    "/login",

    login

);


/* ==================================================
   CHANGE PASSWORD
================================================== */

router.put(

    "/change-password",

    authenticateToken,

    changePassword

);


/* ==================================================
   FORGOT PASSWORD
   REQUEST VERIFICATION CODE
================================================== */

router.post(

    "/forgot-password/request",

    requestPasswordReset

);


/* ==================================================
   FORGOT PASSWORD
   VERIFY CODE
================================================== */

router.post(

    "/forgot-password/verify",

    verifyPasswordReset

);


/* ==================================================
   FORGOT PASSWORD
   RESET PASSWORD
================================================== */

router.post(

    "/forgot-password/reset",

    resetPassword

);


/* ==================================================
   CURRENT USER
================================================== */

router.get(

    "/me",

    authenticateToken,

    getMe

);


/* ==================================================
   UPDATE PROFILE
================================================== */

router.put(

    "/profile",

    authenticateToken,

    updateProfile

);


/* ==================================================
   EXPORT
================================================== */

module.exports =

    router;