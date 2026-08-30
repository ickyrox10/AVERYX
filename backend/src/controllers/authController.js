const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const { pool } = require("../db");


/* ==================================================
   FORGOT PASSWORD - TEMPORARY RESET STORE
================================================== */

const passwordResetStore = new Map();

const RESET_TOKEN_EXPIRY_MS =
    15 * 60 * 1000;


/* ==================================================
   EMAIL DELIVERY - RESEND API
================================================== */

/*
   Uses HTTPS instead of SMTP.

   Required Render environment variables:

   RESEND_API_KEY
   RESEND_FROM

   Example RESEND_FROM:
   AVERYX <no-reply@your-verified-domain.com>
*/

async function sendEmail({
    to,
    subject,
    text,
    html
}) {

    const apiKey =
        process.env.RESEND_API_KEY;

    const from =
        process.env.RESEND_FROM;

    if (
        !apiKey ||
        !from
    ) {

        throw new Error(
            "Email service is not configured. Missing RESEND_API_KEY or RESEND_FROM."
        );

    }

    const response =
        await fetch(
            "https://api.resend.com/emails",
            {

                method:
                    "POST",

                headers: {

                    Authorization:
                        `Bearer ${apiKey}`,

                    "Content-Type":
                        "application/json"

                },

                body:
                    JSON.stringify({

                        from,

                        to: [to],

                        subject,

                        text,

                        html

                    })

            }
        );


    const data =
        await response.json()
            .catch(
                () => ({})
            );


    if (
        !response.ok
    ) {

        throw new Error(
            data.message ||
            data.error ||
            `Email delivery failed with status ${response.status}.`
        );

    }


    return data;

}

/* ==================================================
   GENERATE UNIQUE REFERRAL CODE
================================================== */

async function generateReferralCode() {

    const characters =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    while (true) {

        let code = "AVX-";

        for (let i = 0; i < 7; i++) {

            code +=
                characters[
                    Math.floor(
                        Math.random() *
                        characters.length
                    )
                ];

        }

        const result =
            await pool.query(
                `
                SELECT id
                FROM users
                WHERE referral_code = $1
                LIMIT 1
                `,
                [code]
            );

        if (
            result.rows.length === 0
        ) {

            return code;

        }

    }

}


/* ==================================================
   REGISTER
================================================== */

async function register(req, res) {

    const {
        nickname,
        email,
        phone,
        password,
        confirmPassword,
        referralCode
    } = req.body;


    /* ==================================================
       REQUIRED FIELDS
    ================================================== */

    if (
        !nickname ||
        !email ||
        !password ||
        !confirmPassword
    ) {

        return res.status(400).json({

            success: false,

            message:
                "Nickname, email and password are required."

        });

    }


    /* ==================================================
       CLEAN INPUT
    ================================================== */

    const cleanNickname =
        String(nickname).trim();


    const cleanEmail =
        String(email)
            .trim()
            .toLowerCase();


    const cleanPhone =
        phone &&
        String(phone).trim() !== ""
            ? String(phone).trim()
            : null;


    /* ==================================================
       NICKNAME VALIDATION
    ================================================== */

    if (
        cleanNickname.length < 2 ||
        cleanNickname.length > 50
    ) {

        return res.status(400).json({

            success: false,

            message:
                "Nickname must be between 2 and 50 characters."

        });

    }


    /* ==================================================
       EMAIL VALIDATION
    ================================================== */

    const emailPattern =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


    if (
        !emailPattern.test(
            cleanEmail
        )
    ) {

        return res.status(400).json({

            success: false,

            message:
                "Please enter a valid email address."

        });

    }


    /* ==================================================
       PASSWORD VALIDATION
    ================================================== */

    if (
        password.length < 6
    ) {

        return res.status(400).json({

            success: false,

            message:
                "Password must be at least 6 characters."

        });

    }


    if (
        password !==
        confirmPassword
    ) {

        return res.status(400).json({

            success: false,

            message:
                "Passwords do not match."

        });

    }


    /* ==================================================
       CHECK EXISTING ACCOUNT
    ================================================== */

    let existingUser;


    if (cleanPhone) {

        existingUser =
            await pool.query(
                `
                SELECT id
                FROM users
                WHERE email = $1
                   OR phone = $2
                LIMIT 1
                `,
                [
                    cleanEmail,
                    cleanPhone
                ]
            );

    } else {

        existingUser =
            await pool.query(
                `
                SELECT id
                FROM users
                WHERE email = $1
                LIMIT 1
                `,
                [
                    cleanEmail
                ]
            );

    }


    if (
        existingUser.rows.length > 0
    ) {

        return res.status(409).json({

            success: false,

            message:
                "An account with this email or phone already exists."

        });

    }


    /* ==================================================
       REFERRAL
    ================================================== */

    let referredBy = null;


    if (
        referralCode &&
        String(referralCode).trim() !== ""
    ) {

        const cleanReferralCode =
            String(referralCode)
                .trim()
                .toUpperCase();


        const referralUser =
            await pool.query(
                `
                SELECT id
                FROM users
                WHERE referral_code = $1
                LIMIT 1
                `,
                [
                    cleanReferralCode
                ]
            );


        if (
            referralUser.rows.length === 0
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid referral code."

            });

        }


        referredBy =
            referralUser.rows[0].id;

    }


    /* ==================================================
       HASH PASSWORD
    ================================================== */

    const passwordHash =
        await argon2.hash(
            password
        );


    /* ==================================================
       GENERATE REFERRAL CODE
    ================================================== */

    const newReferralCode =
        await generateReferralCode();


    /* ==================================================
       DATABASE TRANSACTION
    ================================================== */

    const client =
        await pool.connect();


    try {

        await client.query(
            "BEGIN"
        );


        /* ==================================================
           GENERATE PUBLIC UID BEFORE INSERT
        ================================================== */

        let publicUid;


        while (true) {

            const uidResult =
                await client.query(
                    `
                    SELECT COALESCE(
                        MAX(
                            CAST(public_uid AS INTEGER)
                        ),
                        5030
                    ) + 1 AS next_uid

                    FROM users

                    WHERE public_uid
                        ~ '^[0-9]{5}$'
                    `
                );


            publicUid =
                String(
                    uidResult.rows[0].next_uid
                ).padStart(
                    5,
                    "0"
                );


            const uidExists =
                await client.query(
                    `
                    SELECT id
                    FROM users
                    WHERE public_uid = $1
                    LIMIT 1
                    `,
                    [
                        publicUid
                    ]
                );


            if (
                uidExists.rows.length === 0
            ) {

                break;

            }

        }


        /* ==================================================
           CREATE USER
        ================================================== */

        const userResult =
            await client.query(
                `
                INSERT INTO users (
                    nickname,
                    email,
                    phone,
                    password_hash,
                    referral_code,
                    referred_by,
                    public_uid
                )

                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7
                )

                RETURNING
                    id,
                    nickname,
                    email,
                    phone,
                    referral_code,
                    public_uid,
                    created_at
                `,
                [
                    cleanNickname,
                    cleanEmail,
                    cleanPhone,
                    passwordHash,
                    newReferralCode,
                    referredBy,
                    publicUid
                ]
            );


        const user =
            userResult.rows[0];


        /* ==================================================
           CREATE PROFILE
        ================================================== */

        await client.query(
            `
            INSERT INTO profiles (
                user_id,
                highest_unlocked_tier,
                selected_profile_tier
            )

            VALUES (
                $1,
                1,
                1
            )
            `,
            [
                user.id
            ]
        );


        /* ==================================================
           CREATE WALLET
        ================================================== */

        await client.query(
            `
            INSERT INTO wallets (
                user_id,
                balance_usdt
            )

            VALUES (
                $1,
                0
            )
            `,
            [
                user.id
            ]
        );


        /* ==================================================
           COMMIT
        ================================================== */

        await client.query(
            "COMMIT"
        );


        /* ==================================================
           CREATE JWT
        ================================================== */

        const token =
            jwt.sign(
                {
                    userId:
                        user.id
                },

                process.env.JWT_SECRET,

                {
                    expiresIn:
                        "7d"
                }
            );


        /* ==================================================
           SUCCESS RESPONSE
        ================================================== */

        return res.status(201).json({

            success: true,

            message:
                "Account created successfully.",

            user: {

                id:
                    user.id,

                publicUid:
                    user.public_uid,

                nickname:
                    user.nickname,

                email:
                    user.email,

                phone:
                    user.phone,

                referralCode:
                    user.referral_code,

                createdAt:
                    user.created_at

            },

            token

        });


    } catch (error) {

        try {

            await client.query(
                "ROLLBACK"
            );

        } catch (rollbackError) {

            console.error(
                "Rollback error:",
                rollbackError
            );

        }


        console.error(
            "Registration error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to create account."

        });


    } finally {

        client.release();

    }

}


/* ==================================================
   LOGIN
================================================== */

async function login(req, res) {

    const {
        email,
        password
    } = req.body;


    /* ==================================================
       VALIDATION
    ================================================== */

    if (
        !email ||
        !password
    ) {

        return res.status(400).json({

            success: false,

            message:
                "Email and password are required."

        });

    }


    const cleanEmail =
        String(email)
            .trim()
            .toLowerCase();


    /* ==================================================
       FIND USER
    ================================================== */

    const result =
        await pool.query(
            `
            SELECT
                id,
                nickname,
                email,
                phone,
                password_hash,
                referral_code,
                public_uid,
                is_active,
                    account_status,
                created_at

            FROM users

            WHERE email = $1

            LIMIT 1
            `,
            [
                cleanEmail
            ]
        );


    if (
        result.rows.length === 0
    ) {

        return res.status(401).json({

            success: false,

            message:
                "Invalid email or password."

        });

    }


    const user =
        result.rows[0];


    /* ==================================================
       ACCOUNT STATUS
    ================================================== */

    if (
        user.is_active !== true
    ) {

        return res.status(403).json({

            success: false,

            message:
                "This account is currently disabled."

        });

    }


    /* ==================================================
       SUSPENSION STATUS
    ================================================== */

    if (
        String(
            user.account_status || "ACTIVE"
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
       VERIFY PASSWORD
    ================================================== */

    const passwordValid =
        await argon2.verify(
            user.password_hash,
            password
        );


    if (!passwordValid) {

        return res.status(401).json({

            success: false,

            message:
                "Invalid email or password."

        });

    }


    /* ==================================================
       CREATE JWT
    ================================================== */

    const token =
        jwt.sign(
            {
                userId:
                    user.id
            },

            process.env.JWT_SECRET,

            {
                expiresIn:
                    "7d"
            }
        );


    /* ==================================================
       LOGIN SUCCESS
    ================================================== */

    return res.status(200).json({

        success: true,

        message:
            "Login successful.",

        user: {

            id:
                user.id,

            publicUid:
                user.public_uid,

            nickname:
                user.nickname,

            email:
                user.email,

            phone:
                user.phone,

            referralCode:
                user.referral_code,

            createdAt:
                user.created_at

        },

        token

    });

}


/* ==================================================
   CHANGE PASSWORD
================================================== */

async function changePassword(req, res) {

    try {

        const userId =
            req.user.userId;


        const {
            currentPassword,
            newPassword,
            confirmPassword
        } = req.body;


        /* ==================================================
           REQUIRED FIELDS
        ================================================== */

        if (
            !currentPassword ||
            !newPassword ||
            !confirmPassword
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Current password, new password and confirmation are required."

            });

        }


        /* ==================================================
           NEW PASSWORD VALIDATION
        ================================================== */

        if (
            newPassword.length < 6
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "New password must be at least 6 characters."

            });

        }


        if (
            newPassword !==
            confirmPassword
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "New passwords do not match."

            });

        }


        if (
            currentPassword ===
            newPassword
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "New password must be different from your current password."

            });

        }


        /* ==================================================
           GET CURRENT USER PASSWORD
        ================================================== */

        const userResult =
            await pool.query(
                `
                SELECT
                    id,
                    password_hash,
                    is_active

                FROM users

                WHERE id = $1

                LIMIT 1
                `,
                [
                    userId
                ]
            );


        if (
            userResult.rows.length === 0
        ) {

            return res.status(404).json({

                success: false,

                message:
                    "User account not found."

            });

        }


        const user =
            userResult.rows[0];


        /* ==================================================
           ACCOUNT STATUS
        ================================================== */

        if (
            user.is_active !== true
        ) {

            return res.status(403).json({

                success: false,

                message:
                    "This account is currently disabled."

            });

        }


        /* ==================================================
           VERIFY CURRENT PASSWORD
        ================================================== */

        const currentPasswordValid =
            await argon2.verify(
                user.password_hash,
                currentPassword
            );


        if (
            !currentPasswordValid
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Current password is incorrect."

            });

        }


        /* ==================================================
           HASH NEW PASSWORD
        ================================================== */

        const newPasswordHash =
            await argon2.hash(
                newPassword
            );


        /* ==================================================
           UPDATE PASSWORD
        ================================================== */

        const updateResult =
            await pool.query(
                `
                UPDATE users

                SET
                    password_hash = $1

                WHERE id = $2
                  AND is_active = true

                RETURNING id
                `,
                [
                    newPasswordHash,
                    userId
                ]
            );


        if (
            updateResult.rows.length === 0
        ) {

            return res.status(404).json({

                success: false,

                message:
                    "User account not found."

            });

        }


        /* ==================================================
           SUCCESS
        ================================================== */

        return res.status(200).json({

            success: true,

            message:
                "Password changed successfully."

        });


    } catch (error) {

        console.error(
            "Change password error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to change password."

        });

    }

}


/* ==================================================
   FORGOT PASSWORD
   REQUEST VERIFICATION CODE
================================================== */

async function requestPasswordReset(req, res) {

    try {

        const {
            email
        } = req.body;


        /* ==================================================
           REQUIRED FIELD
        ================================================== */

        if (!email) {

            return res.status(400).json({

                success: false,

                message:
                    "Email is required."

            });

        }


        /* ==================================================
           CLEAN EMAIL
        ================================================== */

        const cleanEmail =
            String(email)
                .trim()
                .toLowerCase();


        /* ==================================================
           EMAIL FORMAT
        ================================================== */

        const emailPattern =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


        if (
            !emailPattern.test(
                cleanEmail
            )
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Please enter a valid email address."

            });

        }


        /* ==================================================
           FIND ACCOUNT
        ================================================== */

        const result =
            await pool.query(
                `
                SELECT
                    id,
                    email,
                    is_active

                FROM users

                WHERE email = $1

                LIMIT 1
                `,
                [
                    cleanEmail
                ]
            );


        if (
            result.rows.length === 0
        ) {

            return res.status(404).json({

                success: false,

                message:
                    "No account was found with this email."

            });

        }


        const user =
            result.rows[0];


        /* ==================================================
           ACCOUNT STATUS
        ================================================== */

        if (
            user.is_active !== true
        ) {

            return res.status(403).json({

                success: false,

                message:
                    "This account is currently disabled."

            });

        }


        /* ==================================================
           GENERATE 6-DIGIT OTP
        ================================================== */

        const verificationCode =
            String(
                crypto.randomInt(
                    100000,
                    1000000
                )
            );


        /* ==================================================
           GENERATE RESET TOKEN
        ================================================== */

        const resetToken =
            crypto.randomBytes(
                32
            ).toString("hex");


        const now =
            Date.now();


        /* ==================================================
           STORE RESET SESSION
        ================================================== */

        passwordResetStore.set(
            resetToken,
            {

                userId:
                    user.id,

                email:
                    user.email,

                verificationCode,

                verified:
                    false,

                createdAt:
                    now,

                expiresAt:
                    now +
                    RESET_TOKEN_EXPIRY_MS

            }
        );


        /* ==================================================
           SEND OTP BY EMAIL
        ================================================== */

        await sendEmail({

            from:
                process.env.SMTP_FROM ||
                process.env.SMTP_USER,

            to:
                cleanEmail,

            subject:
                "AVERYX Password Reset Code",

            text:
                `Your AVERYX password reset verification code is: ${verificationCode}

This code expires in 15 minutes.

If you did not request a password reset, you can safely ignore this email.`,

            html:
                `
                <div style="
                    background:#08080b;
                    padding:30px;
                    font-family:Arial,Helvetica,sans-serif;
                    color:#ffffff;
                ">

                    <div style="
                        max-width:500px;
                        margin:auto;
                        background:#111116;
                        border:1px solid #292930;
                        border-radius:16px;
                        padding:30px;
                    ">

                        <h1 style="
                            text-align:center;
                            letter-spacing:4px;
                            margin-bottom:8px;
                        ">
                            AVERYX
                        </h1>

                        <p style="
                            text-align:center;
                            color:#9999a2;
                            font-size:12px;
                            letter-spacing:2px;
                        ">
                            ASCEND BEYOND LIMITS
                        </p>

                        <hr style="
                            border:none;
                            border-top:1px solid #292930;
                            margin:25px 0;
                        ">

                        <h2>
                            Password Reset
                        </h2>

                        <p style="
                            color:#b0b0b8;
                            line-height:1.6;
                        ">
                            Use the verification code below
                            to reset your AVERYX password.
                        </p>

                        <div style="
                            margin:25px 0;
                            padding:20px;
                            text-align:center;
                            background:#0a0a0e;
                            border:1px solid #34343c;
                            border-radius:12px;
                        ">

                            <div style="
                                color:#888891;
                                font-size:11px;
                                letter-spacing:2px;
                                margin-bottom:10px;
                            ">
                                VERIFICATION CODE
                            </div>

                            <div style="
                                font-size:32px;
                                font-weight:bold;
                                letter-spacing:9px;
                            ">
                                ${verificationCode}
                            </div>

                        </div>

                        <p style="
                            color:#888891;
                            font-size:12px;
                            line-height:1.6;
                        ">
                            This code expires in 15 minutes.
                            If you did not request this password
                            reset, you can safely ignore this email.
                        </p>

                    </div>

                </div>
                `

        });


        /* ==================================================
           SUCCESS RESPONSE
           OTP IS NOT RETURNED TO FRONTEND
        ================================================== */

        return res.status(200).json({

            success: true,

            message:
                "Verification code sent to your email.",

            resetToken

        });


    } catch (error) {

        console.error(
            "Password reset request error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to send the verification code. Please try again later."

        });

    }

}


/* ==================================================
   FORGOT PASSWORD
   VERIFY VERIFICATION CODE
================================================== */

async function verifyPasswordReset(
    req,
    res
) {

    try {

        const {
            resetToken,
            verificationCode
        } = req.body;


        /* ==================================================
           REQUIRED FIELDS
        ================================================== */

        if (
            !resetToken ||
            !verificationCode
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Reset token and verification code are required."

            });

        }


        /* ==================================================
           GET RESET SESSION
        ================================================== */

        const resetSession =
            passwordResetStore.get(
                resetToken
            );


        if (!resetSession) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid or expired reset session."

            });

        }


        /* ==================================================
           CHECK EXPIRY
        ================================================== */

        if (
            Date.now() >
            resetSession.expiresAt
        ) {

            passwordResetStore.delete(
                resetToken
            );


            return res.status(400).json({

                success: false,

                message:
                    "Verification code has expired. Please request a new one."

            });

        }


        /* ==================================================
           VERIFY CODE
        ================================================== */

        if (
            String(
                verificationCode
            ).trim() !==
            resetSession.verificationCode
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid verification code."

            });

        }


        /* ==================================================
           MARK RESET SESSION VERIFIED
        ================================================== */

        resetSession.verified =
            true;


        resetSession.verifiedAt =
            Date.now();


        passwordResetStore.set(
            resetToken,
            resetSession
        );


        /* ==================================================
           SUCCESS
        ================================================== */

        return res.status(200).json({

            success: true,

            message:
                "Verification successful.",

            resetToken

        });


    } catch (error) {

        console.error(
            "Password reset verification error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to verify the code."

        });

    }

}


/* ==================================================
   FORGOT PASSWORD
   RESET PASSWORD
================================================== */

async function resetPassword(
    req,
    res
) {

    try {

        const {
            resetToken,
            newPassword,
            confirmPassword
        } = req.body;


        /* ==================================================
           REQUIRED FIELDS
        ================================================== */

        if (
            !resetToken ||
            !newPassword ||
            !confirmPassword
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Reset token, new password and confirmation are required."

            });

        }


        /* ==================================================
           PASSWORD VALIDATION
        ================================================== */

        if (
            newPassword.length < 6
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Password must be at least 6 characters."

            });

        }


        if (
            newPassword !==
            confirmPassword
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "New passwords do not match."

            });

        }


        /* ==================================================
           GET RESET SESSION
        ================================================== */

        const resetSession =
            passwordResetStore.get(
                resetToken
            );


        if (!resetSession) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid or expired reset session."

            });

        }


        /* ==================================================
           CHECK EXPIRY
        ================================================== */

        if (
            Date.now() >
            resetSession.expiresAt
        ) {

            passwordResetStore.delete(
                resetToken
            );


            return res.status(400).json({

                success: false,

                message:
                    "Reset session has expired. Please start again."

            });

        }


        /* ==================================================
           VERIFICATION REQUIRED
        ================================================== */

        if (
            resetSession.verified !== true
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Please verify the verification code first."

            });

        }


        /* ==================================================
           FIND ACTIVE USER
        ================================================== */

        const userResult =
            await pool.query(
                `
                SELECT
                    id,
                    password_hash,
                    is_active

                FROM users

                WHERE id = $1

                LIMIT 1
                `,
                [
                    resetSession.userId
                ]
            );


        if (
            userResult.rows.length === 0
        ) {

            passwordResetStore.delete(
                resetToken
            );


            return res.status(404).json({

                success: false,

                message:
                    "User account not found."

            });

        }


        const user =
            userResult.rows[0];


        /* ==================================================
           ACCOUNT STATUS
        ================================================== */

        if (
            user.is_active !== true
        ) {

            passwordResetStore.delete(
                resetToken
            );


            return res.status(403).json({

                success: false,

                message:
                    "This account is currently disabled."

            });

        }


        /* ==================================================
           HASH NEW PASSWORD
        ================================================== */

        const newPasswordHash =
            await argon2.hash(
                newPassword
            );


        /* ==================================================
           UPDATE PASSWORD
        ================================================== */

        const updateResult =
            await pool.query(
                `
                UPDATE users

                SET
                    password_hash = $1

                WHERE id = $2
                  AND is_active = true

                RETURNING id
                `,
                [
                    newPasswordHash,
                    resetSession.userId
                ]
            );


        if (
            updateResult.rows.length === 0
        ) {

            return res.status(404).json({

                success: false,

                message:
                    "Unable to update the password."

            });

        }


        /* ==================================================
           CONSUME RESET SESSION
        ================================================== */

        passwordResetStore.delete(
            resetToken
        );


        /* ==================================================
           SUCCESS
        ================================================== */

        return res.status(200).json({

            success: true,

            message:
                "Password reset successfully."

        });


    } catch (error) {

        console.error(
            "Password reset error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to reset password."

        });

    }

}


/* ==================================================
   GET CURRENT USER
================================================== */

async function getMe(req, res) {

    try {

        const userId =
            req.user.userId;


        /* ==================================================
           GET USER
        ================================================== */

        const userResult =
            await pool.query(
                `
                SELECT
                    id,
                    nickname,
                    email,
                    phone,
                    referral_code,
                    public_uid,
                    created_at

                FROM users

                WHERE id = $1
                  AND is_active = true

                LIMIT 1
                `,
                [
                    userId
                ]
            );


        if (
            userResult.rows.length === 0
        ) {

            return res.status(404).json({

                success: false,

                message:
                    "User account not found."

            });

        }


        const user =
            userResult.rows[0];


        /* ==================================================
           GET PROFILE
        ================================================== */

        const profileResult =
            await pool.query(
                `
                SELECT
                    highest_unlocked_tier,
                    selected_profile_tier

                FROM profiles

                WHERE user_id = $1

                LIMIT 1
                `,
                [
                    userId
                ]
            );


        const profile =
            profileResult.rows[0] ||
            null;


        /* ==================================================
           GET WALLET
        ================================================== */

        const walletResult =
            await pool.query(
                `
                SELECT
                    balance_usdt

                FROM wallets

                WHERE user_id = $1

                LIMIT 1
                `,
                [
                    userId
                ]
            );


        const wallet =
            walletResult.rows[0] ||
            null;


        /* ==================================================
           RESPONSE
        ================================================== */

        return res.status(200).json({

            success: true,

            user: {

                id:
                    user.id,

                publicUid:
                    user.public_uid,

                nickname:
                    user.nickname,

                email:
                    user.email,

                phone:
                    user.phone,

                referralCode:
                    user.referral_code,

                createdAt:
                    user.created_at

            },

            profile: {

                highestUnlockedTier:
                    profile
                        ? profile.highest_unlocked_tier
                        : 1,

                selectedProfileTier:
                    profile
                        ? profile.selected_profile_tier
                        : 1

            },

            wallet: {

                balanceUSDT:
                    wallet
                        ? wallet.balance_usdt
                        : 0

            }

        });


    } catch (error) {

        console.error(
            "Get current user error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to load account."

        });

    }

}


/* ==================================================
   UPDATE PROFILE
================================================== */

async function updateProfile(req, res) {

    try {

        const userId =
            req.user.userId;


        const {
            nickname,
            email,
            phone,
            selectedProfileTier
        } = req.body;


        const cleanNickname =
            String(
                nickname || ""
            ).trim();


        const cleanEmail =
            String(
                email || ""
            )
                .trim()
                .toLowerCase();


        const cleanPhone =
            phone &&
            String(phone).trim() !== ""
                ? String(phone).trim()
                : null;


        if (
            cleanNickname.length < 2 ||
            cleanNickname.length > 50
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Nickname must be between 2 and 50 characters."

            });

        }


        if (
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
                .test(cleanEmail)
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Please enter a valid email address."

            });

        }


        const profileResult =
            await pool.query(
                `
                SELECT
                    highest_unlocked_tier,
                    selected_profile_tier

                FROM profiles

                WHERE user_id = $1

                LIMIT 1
                `,
                [
                    userId
                ]
            );


        if (
            !profileResult.rows.length
        ) {

            return res.status(404).json({

                success: false,

                message:
                    "Profile not found."

            });

        }


        const highestUnlocked =
            Number(
                profileResult
                    .rows[0]
                    .highest_unlocked_tier
            ) || 1;


        let selectedTier =
            Number(
                selectedProfileTier
            ) || 1;


        if (
            selectedTier < 1 ||
            selectedTier > highestUnlocked
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "This subscription logo is not unlocked."

            });

        }


        const emailExists =
            await pool.query(
                `
                SELECT id

                FROM users

                WHERE email = $1
                  AND id <> $2

                LIMIT 1
                `,
                [
                    cleanEmail,
                    userId
                ]
            );


        if (
            emailExists.rows.length
        ) {

            return res.status(409).json({

                success: false,

                message:
                    "This email is already registered."

            });

        }


        const userResult =
            await pool.query(
                `
                UPDATE users

                SET
                    nickname = $1,
                    email = $2,
                    phone = $3

                WHERE id = $4
                  AND is_active = true

                RETURNING
                    id,
                    nickname,
                    email,
                    phone,
                    referral_code,
                    public_uid,
                    created_at
                `,
                [
                    cleanNickname,
                    cleanEmail,
                    cleanPhone,
                    userId
                ]
            );


        if (
            !userResult.rows.length
        ) {

            return res.status(404).json({

                success: false,

                message:
                    "User account not found."

            });

        }


        const updatedProfile =
            await pool.query(
                `
                UPDATE profiles

                SET
                    selected_profile_tier = $1

                WHERE user_id = $2

                RETURNING
                    highest_unlocked_tier,
                    selected_profile_tier
                `,
                [
                    selectedTier,
                    userId
                ]
            );


        const user =
            userResult.rows[0];


        const profile =
            updatedProfile.rows[0];


        return res.status(200).json({

            success: true,

            message:
                "Profile updated successfully.",

            user: {

                id:
                    user.id,

                publicUid:
                    user.public_uid,

                nickname:
                    user.nickname,

                email:
                    user.email,

                phone:
                    user.phone,

                referralCode:
                    user.referral_code,

                createdAt:
                    user.created_at

            },

            profile: {

                highestUnlockedTier:
                    Number(
                        profile
                            .highest_unlocked_tier
                    ) || 1,

                selectedProfileTier:
                    Number(
                        profile
                            .selected_profile_tier
                    ) || selectedTier

            }

        });


    } catch (error) {

        console.error(
            "Update profile error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to save profile."

        });

    }

}


/* ==================================================
   EXPORT
================================================== */

module.exports = {

    register,

    login,

    changePassword,

    requestPasswordReset,

    verifyPasswordReset,

    resetPassword,

    getMe,

    updateProfile

};