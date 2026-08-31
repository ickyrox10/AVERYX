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

    /*
     * Shared authentication state.
     *
     * Other protected pages can reuse this promise/result instead
     * of immediately sending another identical /api/auth/me request.
     */
    window.AVERYX_AUTH = window.AVERYX_AUTH || {
        verified: false,
        user: null,
        data: null,
        promise: null
    };

    async function verifyAuthentication() {
        const token = localStorage.getItem(TOKEN_KEY);

        // No token means the visitor is not authenticated.
        if (!token) {
            redirectToLogin();
            throw new Error("No authentication token found.");
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

                /*
                 * Store the verified backend result so pages
                 * can reuse it without duplicating /api/auth/me.
                 */
                window.AVERYX_AUTH.verified = true;
                window.AVERYX_AUTH.user =
                    data && data.user ? data.user : null;
                window.AVERYX_AUTH.data = data || null;

                return data;
            }

            /*
             * Invalid token, expired session,
             * suspended account, or disabled account.
             */
            redirectToLogin();
            throw new Error("Authentication verification failed.");

        } catch (error) {
            /*
             * If redirectToLogin already handled the failure,
             * preserve the redirect behavior.
             */
            if (!window.AVERYX_AUTH.verified) {
                console.error(
                    "Authentication verification failed:",
                    error
                );

                redirectToLogin();
            }

            throw error;
        }
    }

    /*
     * Start verification once and expose the same promise
     * for other scripts on the page.
     */
    window.AVERYX_AUTH.promise = verifyAuthentication()
        .then((data) => {
            /*
             * Reveal the protected page only after
             * authentication verification succeeds.
             */
            document.documentElement.style.visibility = "";

            return data;
        })
        .catch((error) => {
            /*
             * Authentication failure already redirects to login.
             */
            return Promise.reject(error);
        });

    /*
     * Hide protected content until authentication
     * verification is complete.
     */
    document.documentElement.style.visibility = "hidden";

})();