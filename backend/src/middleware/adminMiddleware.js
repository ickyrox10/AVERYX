const jwt = require("jsonwebtoken");


/* ==================================================
   ADMIN AUTHENTICATION MIDDLEWARE
================================================== */

function authenticateAdmin(req, res, next) {

    try {

        const adminJwtSecret =
            process.env.ADMIN_JWT_SECRET;


        if (!adminJwtSecret) {

            console.error(
                "ADMIN_JWT_SECRET is not configured."
            );

            return res.status(500).json({

                success: false,

                message:
                    "Admin authentication is not configured."

            });

        }


        /* ==================================================
           GET AUTHORIZATION HEADER
        ================================================== */

        const authHeader =
            req.headers.authorization;


        if (!authHeader) {

            return res.status(401).json({

                success: false,

                message:
                    "Admin authentication required."

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
                    "Invalid admin authentication format."

            });

        }


        const token =
            parts[1];


        if (!token) {

            return res.status(401).json({

                success: false,

                message:
                    "Admin authentication token is missing."

            });

        }


        /* ==================================================
           VERIFY ADMIN JWT
        ================================================== */

        const decoded =
            jwt.verify(
                token,
                adminJwtSecret
            );


        /* ==================================================
           REQUIRE ADMIN ROLE
        ================================================== */

        if (
            !decoded ||
            decoded.role !== "admin"
        ) {

            return res.status(403).json({

                success: false,

                message:
                    "Admin access required."

            });

        }


        /* ==================================================
           ATTACH ADMIN DATA
        ================================================== */

        req.admin =
            decoded;


        /* ==================================================
           CONTINUE
        ================================================== */

        next();

    } catch (error) {

        console.error(
            "Admin authentication error:",
            error.message
        );


        if (
            error.name ===
            "TokenExpiredError"
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Admin session has expired. Please log in again."

            });

        }


        return res.status(401).json({

            success: false,

            message:
                "Invalid admin authentication token."

        });

    }

}


/* ==================================================
   EXPORT
================================================== */

module.exports = {

    authenticateAdmin

};
