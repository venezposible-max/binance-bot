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
            'PAXG', 'WBTC', 'USD1', 'USDE', 'SUSD', 'FRAX', 'LUSD', 'GUSD', 'FUSD',
            'ZAMA', 'ZEC' // User Requested Blacklist
        ];

        // Filter valid USDT pairs (exclude stablecoins & non-volatile assets)
        const relevant = allPairs.filter(p => {
            if (!p.symbol.endsWith('USDT')) return false;

            // REGEX: Filter out non-alphanumeric symbols (e.g. Chinese chars like 币安人生USDT)
            if (!/^[A-Z0-9]+$/.test(p.symbol)) return false;

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
/**
 * Wait for a specified duration (ms)
 * Used to throttle requests and avoid 429
 */
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch K-Line data (Candlesticks)
 * @param {string} symbol - Pair symbol (e.g., BTCUSDT)
 * @param {string} interval - Time interval (1h, 4h, 1d)
 * @param {number} limit - Number of candles (default 100 for RSI calc)
 */
export const fetchCandles = async (symbol, interval = '4h', limit = 100) => {
    try {
        // HANDLE BATCH (ARRAY) REQUEST
        if (Array.isArray(symbol)) {
            // Parallel Fetch with Map Return
            const promises = symbol.map(async (s) => {
                const klines = await fetchCandles(s, interval, limit);
                return { symbol: s, data: klines };
            });

            const results = await Promise.all(promises);

            // Convert to Object Map: { BTCUSDT: [...], ETHUSDT: [...] }
            return results.reduce((acc, item) => {
                acc[item.symbol] = item.data;
                return acc;
            }, {});
        }

        // SINGULAR REQUEST
        // JITTER: Random delay (300ms - 800ms) to avoid synchronized bursts hitting rate limits
        const delay = Math.floor(Math.random() * 500) + 300;
        await wait(delay);

        // Use backend proxy to bypass browser geo-blocks
        const response = await axios.get(`/api/candles`, {
            params: { symbol, interval, limit },
            timeout: 20000 // Extended timeout for Global/GCP failover loops
        });

        return response.data; // Already formatted by backend
    } catch (error) {
        console.error(`Error fetching candles for ${symbol}:`, error.message);
        // If batch failed (unlikely here as we map), return empty. 
        // If singular failed, return empty array.
        return Array.isArray(symbol) ? {} : [];
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
            console.error("Global Fetch failed:", globalError.message);
            // Removed Binance US fallback to prevent false $0 prices for Global-only assets (ZAMA)
            return {};
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
