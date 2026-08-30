/*
 * AVERYX Frontend Authentication Guard
 *
 * Add this script to protected pages:
 * <script src="auth-guard.js"></script>
 */

(function () {
    "use strict";

    const TOKEN_KEY = "averyx_token";
    const USER_KEY = "averyx_user";

    /*
     * Match the API configuration used by the AVERYX frontend.
     *
     * On the deployed website, relative /api paths are used.
     * When opening files directly locally, the Render backend
     * is used as a fallback.
     */
    const API_BASE =
        window.AVERYX_API_BASE_URL ||
        (
            window.location.protocol === "file:"
                ? "https://averyx.onrender.com"
                : ""
        );

    const LOGIN_PAGE = "login.html";


    function clearAuth() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
    }


    function redirectToLogin() {
        clearAuth();

        if (!window.location.pathname.endsWith(LOGIN_PAGE)) {
            window.location.replace(LOGIN_PAGE);
        }
    }


    async function verifyAuthentication() {
        const token = localStorage.getItem(TOKEN_KEY);


        // No token means the visitor is not authenticated.
        if (!token) {
            redirectToLogin();
            return;
        }


        try {
            const response = await fetch(
                `${API_BASE}/api/auth/me`,
                {
                    method: "GET",

                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json"
                    },

                    cache: "no-store"
                }
            );


            /*
             * Valid and active account.
             */
            if (response.ok) {
                const data = await response.json();


                /*
                 * Keep the latest user information if
                 * the backend provides it.
                 */
                if (data && data.user) {
                    localStorage.setItem(
                        USER_KEY,
                        JSON.stringify(data.user)
                    );
                }


                // Reveal the protected page.
                document.documentElement.style.visibility = "";

                return;
            }


            /*
             * Invalid token, expired session,
             * suspended account, or disabled account.
             */
            redirectToLogin();


        } catch (error) {
            console.error(
                "Authentication verification failed:",
                error
            );


            /*
             * Do not leave a protected page accessible
             * when the account cannot be verified.
             */
            redirectToLogin();
        }
    }


    /*
     * Hide protected content until authentication
     * verification is complete.
     */
    document.documentElement.style.visibility = "hidden";


    verifyAuthentication();

})();