const express = require("express");


const {
    getPremiumStatus,
    purchasePremiumPass
} = require("../controllers/premiumController");


const {
    authenticateToken
} = require("../middleware/authMiddleware");


const router = express.Router();


/* ==================================================
   AVERYX PREMIUM STATUS

   Returns:
   - Whether Premium Pass system is enabled
   - Current user's Premium status
   - Pass configuration
================================================== */

router.get(
    "/status",
    authenticateToken,
    getPremiumStatus
);


/* ==================================================
   PURCHASE AVERYX PREMIUM PASS

   Authentication required.

   The controller handles:
   - Feature flag check
   - Pass availability
   - Payment verification
   - Duplicate transaction protection
   - Premium activation
   - Purchase recording
================================================== */

router.post(
    "/purchase",
    authenticateToken,
    purchasePremiumPass
);


/* ==================================================
   EXPORT
================================================== */

module.exports = router;