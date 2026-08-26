const jwt = require("jsonwebtoken");


/* ==================================================
   AUTHENTICATION MIDDLEWARE
================================================== */

function authenticateToken(req, res, next) {

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
           ATTACH USER DATA
        ================================================== */

        req.user = decoded;


        /* ==================================================
           CONTINUE
        ================================================== */

        next();

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