/**
 * API CONFIGURATION BRIDGE
 * Determines where to send requests based on the current environment.
 */

export const getApiBaseUrl = () => {
    // Safety check for SSR (though this is SPA)
    if (typeof window === 'undefined') return '';

    const hostname = window.location.hostname;

    // 1. If running on Vercel -> Point to Railway Backend
    if (hostname.includes('vercel.app')) {
        return 'https://binance-bot-production-28a6.up.railway.app';
    }

    // 2. Localhost or Railway Monorepo -> Relative path (uses Proxy or Same Origin)
    return '';
};

// Start Helper
export const API_BASE = getApiBaseUrl();

export const isVercel = () => {
    if (typeof window === 'undefined') return false;
    return window.location.hostname.includes('vercel.app');
};
