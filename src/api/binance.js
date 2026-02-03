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
        // [NEW] Fetch from our Backend Sync (Redis)
        const res = await axios.get('/api/get-market-pairs');
        const top10 = res.data;

        // Validation
        if (!Array.isArray(top10) || top10.length === 0) {
            console.warn('Backend returned empty pairs, using fallback');
            return TOP_PAIRS;
        }

        // Update local reference
        TOP_PAIRS = top10;
        return top10;
    } catch (e) {
        console.error('Error fetching Top Pairs from Backend:', e);
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
/**
 * Direct Browser Fetch (Robust Multi-Mirror Fallback)
 */
const fetchCandlesDirect = async (symbolOrArray, interval, limit) => {
    const symbols = Array.isArray(symbolOrArray) ? symbolOrArray : [symbolOrArray];
    const results = {};

    // Global Mirrors (Optimized for Venezuela/LATAM and General Global access)
    // removed .us as per user request
    const MIRRORS = [
        'https://api.binance.com',
        'https://api1.binance.com',
        'https://api2.binance.com',
        'https://api3.binance.com',
        'https://api-gcp.binance.com',
        'https://data-api.binance.vision' // Public Data fallback
    ];

    // Parallel Fetch with Round-Robin Failover
    const promises = symbols.map(async (s) => {
        let finalData = [];

        for (const host of MIRRORS) {
            try {
                const res = await axios.get(`${host}/api/v3/klines`, {
                    params: { symbol: s, interval, limit },
                    timeout: 4000 // Aggressive timeout to switch mirrors quickly
                });

                if (res.data && Array.isArray(res.data) && res.data.length > 0) {
                    finalData = res.data.map(c => ({
                        time: c[0],
                        open: parseFloat(c[1]),
                        high: parseFloat(c[2]),
                        low: parseFloat(c[3]),
                        close: parseFloat(c[4]),
                        volume: parseFloat(c[5])
                    }));
                    break; // Found data, exit loop
                }
            } catch (e) {
                // Ignore and try next mirror
            }
        }

        if (finalData.length === 0) {
            console.warn(`All mirrors failed for ${s}`);
        }

        return { s, data: finalData };
    });

    const items = await Promise.all(promises);

    // If singular input, return array
    if (!Array.isArray(symbolOrArray)) {
        return items[0].data;
    }

    // If batch input, return Map
    items.forEach(i => results[i.s] = i.data);
    return results;
};

export const fetchCandles = async (symbol, interval = '4h', limit = 300) => {
    try {
        // HANDLE BATCH (ARRAY) REQUEST
        if (Array.isArray(symbol)) {
            const symbolsParam = symbol.join(',');

            // Try Backend Proxy
            const response = await axios.get(`/api/candles`, {
                params: { symbol: symbolsParam, interval, limit },
                timeout: 30000
            });

            const data = response.data;

            // Validate: If backend returns empty object or all empty arrays
            const hasData = Object.values(data).some(arr => arr && arr.length > 0);
            if (!hasData) {
                throw new Error("Backend returned empty candle data");
            }

            return data;
        }

        // SINGULAR REQUEST
        const delay = Math.floor(Math.random() * 500) + 300;
        await wait(delay);

        const response = await axios.get(`/api/candles`, {
            params: { symbol, interval, limit },
            timeout: 20000
        });

        if (!response.data || response.data.length === 0) {
            throw new Error("Backend returned empty candle data");
        }

        return response.data;

    } catch (error) {
        console.warn(`Backend Candle Proxy Failed (${error.message}). Switching to Direct Browser Fetch...`);
        return await fetchCandlesDirect(symbol, interval, limit);
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

// Helper for Direct Ticker Fetch
const fetchTickerDirect = async (symbols) => {
    const prices = {};
    const MIRRORS = [
        'https://api.binance.com',
        'https://api1.binance.com', 'https://api2.binance.com', 'https://api3.binance.com',
        'https://api-gcp.binance.com'
    ];

    // We can fetch all prices in one go usually, but mirrors require one request.
    // Ticker endpoint: /api/v3/ticker/price?symbol=... or /api/v3/ticker/price for all.
    // Fetching ALL is heavy but reliable.
    // Fetching specific symbols individually is safer for rate limits if list is small (10 pairs).

    // Let's try fetching individual symbols in parallel for robustness.
    const promises = symbols.map(async (s) => {
        for (const host of MIRRORS) {
            try {
                const res = await axios.get(`${host}/api/v3/ticker/price`, {
                    params: { symbol: s },
                    timeout: 2000
                });
                if (res.data && res.data.price) {
                    return { s, p: parseFloat(res.data.price) };
                }
            } catch (e) {
                // Next mirror
            }
        }
        return { s, p: 0 };
    });

    const results = await Promise.all(promises);
    results.forEach(item => {
        if (item.p > 0) prices[item.s] = item.p;
    });

    return prices;
};

export const fetchTickerPrices = async (symbols) => {
    try {
        const symbolParam = symbols.join(',');
        // Add timestamp to bust Vercel/Browser Cache
        const response = await axios.get(`/api/ticker?symbols=${symbolParam}&_t=${Date.now()}`, { timeout: 5000 });

        // Validation: If backend returns empty, throw to trigger fallback
        if (!response.data || Object.keys(response.data).length === 0) {
            throw new Error("Backend Ticker Empty");
        }

        return response.data;
    } catch (error) {
        console.warn("Backend Ticker Failed, using Direct Fallback...", error.message);
        return await fetchTickerDirect(symbols);
    }
};
