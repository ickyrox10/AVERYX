const jwt = require("jsonwebtoken");
const { pool } = require("../db");


/* ==================================================
   AUTHENTICATION MIDDLEWARE
================================================== */

async function authenticateToken(req, res, next) {

    try {

        /* ==================================================
           GET AUTHORIZATION HEADER
        ================================================== */

        const authHeader =
            req.headers.authorization;


        if (!authHeader) {

            return res.status(401).json({

                success: false,

                message:
                    "Authentication required."

            });

        }


        /* ==================================================
           CHECK BEARER FORMAT
        ================================================== */

        const parts =
            authHeader.split(" ");


        if (
            parts.length !== 2 ||
            parts[0] !== "Bearer"
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid authentication format."

            });

        }


        const token =
            parts[1];


        if (!token) {

            return res.status(401).json({

                success: false,

                message:
                    "Authentication token is missing."

            });

        }


        /* ==================================================
           VERIFY JWT
        ================================================== */

        const decoded =
            jwt.verify(
                token,
                process.env.JWT_SECRET
            );


        /* ==================================================
           VERIFY CURRENT USER ACCOUNT STATUS
        ================================================== */

        if (
            !decoded ||
            !decoded.userId
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid authentication token."

            });

        }


        const userResult =
            await pool.query(

                `
                SELECT
                    id,
                    is_active,
                    account_status

                FROM users

                WHERE id = $1

                LIMIT 1
                `,

                [
                    decoded.userId
                ]

            );


        if (
            userResult.rows.length === 0
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "User account not found."

            });

        }


        const currentUser =
            userResult.rows[0];


        if (
            currentUser.is_active !== true
        ) {

            return res.status(403).json({

                success: false,

                code:
                    "ACCOUNT_DISABLED",

                message:
                    "This account is currently disabled."

            });

        }


        if (
            String(
                currentUser.account_status || "ACTIVE"
            ).toUpperCase() === "SUSPENDED"
        ) {

            return res.status(403).json({

                success: false,

                code:
                    "ACCOUNT_SUSPENDED",

                message:
                    "Your account has been suspended. Please contact support."

            });

        }


        /* ==================================================
           ATTACH USER DATA
        ================================================== */

        req.user = decoded;


        /* ==================================================
           CONTINUE
        ================================================== */

        return next();

    } catch (error) {

        console.error(
            "Authentication error:",
            error.message
        );


        if (
            error.name ===
            "TokenExpiredError"
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Your session has expired. Please log in again."

            });

        }


        return res.status(401).json({

            success: false,

            message:
                "Invalid authentication token."

        });

    }

}


/* ==================================================
   EXPORT
================================================== */

module.exports = {

    authenticateToken

};