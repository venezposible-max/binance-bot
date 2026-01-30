import axios from 'axios';

// --- SHARED CONFIG ---
// Region Switch: 'US' (Default) or 'EU' (Binance Global)
// Set this via Railway Environment Variable: REGION=EU
export const getConfig = () => {
    return {
        REGION: process.env.REGION || 'US',
        // URLs
        BINANCE_US: 'https://api.binance.us/api/v3',
        BINANCE_GLOBAL: 'https://api.binance.com/api/v3',
    };
};

export const getBaseUrl = () => {
    const config = getConfig();
    return config.REGION === 'EU' ? config.BINANCE_GLOBAL : config.BINANCE_US;
};
