import axios from 'axios';

const BASE_URL = 'https://api.binance.com/api/v3';

// Initial fallback until dynamic fetch loads
export let TOP_PAIRS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'TRXUSDT', 'DOTUSDT'
];

/**
 * Fetch Top 10 Pairs by Volume (Dynamic)
 */
export const fetchTopPairs = async () => {
    try {
        const res = await axios.get(`${BASE_URL}/ticker/24hr`);
        const allPairs = res.data;

        // Explicit Blacklist of Stablecoins & Non-Volatile Assets
        const BLACKLIST = [
            'USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'AEUR', 'EUR', 'GBP',
            'PAXG', 'WBTC', 'USD1', 'USDE', 'SUSD', 'FRAX', 'LUSD', 'GUSD', 'FUSD'
        ];

        // Filter valid USDT pairs (exclude stablecoins & non-volatile assets)
        const relevant = allPairs.filter(p => {
            if (!p.symbol.endsWith('USDT')) return false;

            // Check against Blacklist
            const isBlacklisted = BLACKLIST.some(blocked => p.symbol.includes(blocked));
            if (isBlacklisted) return false;

            // Volume Filter
            return parseFloat(p.quoteVolume) > 5000000;
        });

        // Sort by Volume (quoteVolume = Volume in USDT)
        relevant.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

        // Get Top 10
        const top10 = relevant.slice(0, 10).map(p => p.symbol);

        // Update local reference
        TOP_PAIRS = top10;
        return top10;
    } catch (e) {
        console.error('Error fetching Top Pairs:', e);
        return TOP_PAIRS; // Return fallback on error
    }
};

/**
 * Fetch K-Line data (Candlesticks)
 * @param {string} symbol - Pair symbol (e.g., BTCUSDT)
 * @param {string} interval - Time interval (1h, 4h, 1d)
 * @param {number} limit - Number of candles (default 100 for RSI calc)
 */
export const fetchCandles = async (symbol, interval = '4h', limit = 100) => {
    try {
        // Use backend proxy to bypass browser geo-blocks
        const response = await axios.get(`/api/candles`, {
            params: { symbol, interval, limit },
            timeout: 10000
        });

        return response.data; // Already formatted by backend
    } catch (error) {
        console.error(`Error fetching candles for ${symbol}:`, error);
        return [];
    }
};

/**
 * Fetch Real-Time Prices via Backend Proxy (with Browser Fallback)
 * @param {Array} symbols - List of symbols (e.g. ['BTCUSDT', 'ETHUSDT'])
 */
export const fetchTickerPrices = async (symbols) => {
    try {
        const symbolsParam = symbols.join(',');

        // 1. Try Backend Proxy (Best for CORS, but might be Rate Limited/IP Blocked)
        // If this works, great. If it fails or returns empty (due to IP block), we catch it.
        const response = await axios.get(`/api/ticker`, {
            params: { symbols: symbolsParam },
            timeout: 5000
        });

        if (response.data && Object.keys(response.data).length > 0) {
            return response.data;
        }

        throw new Error("Backend returned empty data");

    } catch (error) {
        console.warn("Backend Ticker failed, trying Direct Browser Fetch...", error.message);

        // Helper to format ticker array to object
        const processTickerData = (data, symbols) => {
            const prices = {};
            data.forEach(t => {
                if (symbols.includes(t.symbol)) {
                    prices[t.symbol] = parseFloat(t.price);
                }
            });
            return prices;
        };

        // 2. Fallback A: Direct Browser Fetch (GLOBAL - api.binance.com)
        // This is what the user requested and works best for international IPs.
        try {
            console.log("Fallback A: Trying Binance Global...");
            const globalResponse = await axios.get('https://api.binance.com/api/v3/ticker/price', {
                timeout: 3000
            });
            return processTickerData(globalResponse.data, symbols);
        } catch (globalError) {
            console.warn("Global Fetch failed, trying US...", globalError.message);

            // 3. Fallback B: Direct Browser Fetch (US - api.binance.us)
            try {
                console.log("Fallback B: Trying Binance US...");
                const usResponse = await axios.get('https://api.binance.us/api/v3/ticker/price', {
                    timeout: 3000
                });
                return processTickerData(usResponse.data, symbols);
            } catch (usError) {
                console.error("All Fetch Methods Failed:", usError.message);
                return {};
            }
        }
    }
};

/**
 * Fetch 24hr Ticker for current price and change %
 * (Legacy / unused or used for manual checks)
 */
export const fetchTicker24h = async () => {
    try {
        const response = await axios.get(`${BASE_URL}/ticker/24hr`);
        // Filter only our top pairs to optimize
        return response.data.filter(t => TOP_PAIRS.includes(t.symbol));
    } catch (error) {
        console.error("Error fetching ticker:", error);
        return [];
    }
};
/**
 * Fetch Order Book Depth (Bids/Asks) via Backend Proxy
 * @param {string} symbol - Pair symbol (e.g., BTCUSDT)
 * @param {number} limit - Depth limit (default 50)
 */
export const fetchDepth = async (symbol, limit = 50) => {
    try {
        const response = await axios.get(`/api/depth`, {
            params: { symbol, limit },
            timeout: 5000
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching depth for ${symbol}:`, error);
        return null;
    }
};
