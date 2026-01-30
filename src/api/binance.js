import axios from 'axios';

// Top 20 Pairs by typical volume/relevance
export const TOP_PAIRS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'TRXUSDT', 'DOTUSDT',
    'MATICUSDT', 'LTCUSDT', 'LINKUSDT', 'UNIUSDT', 'ATOMUSDT',
    'ETCUSDT', 'FILUSDT', 'XLMUSDT', 'BCHUSDT', 'NEARUSDT'
];

const BASE_URL = 'https://api.binance.com/api/v3';

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
 * Fetch 24hr Ticker for current price and change %
 */
/**
 * Fetch Real-Time Prices via Backend Proxy (with Browser Fallback)
 * @param {Array} symbols - List of symbols (e.g. ['BTCUSDT', 'ETHUSDT'])
 */
export const fetchTickerPrices = async (symbols) => {
    try {
        const symbolsParam = symbols.join(',');

        // 1. Try Backend Proxy (Best for CORS, but might be Rate Limited/IP Blocked)
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

        // 2. Fallback: Direct Browser Fetch (might work if backend IP is dirty)
        // Note: Binance US usually allows CORS for public data.
        try {
            const fallbackResponse = await axios.get('https://api.binance.us/api/v3/ticker/price', {
                timeout: 3000
            });

            // Transform array [{symbol, price}] to object {symbol: price}
            const fallbackPrices = {};
            fallbackResponse.data.forEach(t => {
                if (symbols.includes(t.symbol)) {
                    fallbackPrices[t.symbol] = parseFloat(t.price);
                }
            });
            return fallbackPrices;
        } catch (directError) {
            console.error("Direct Browser Fetch also failed:", directError.message);
            return {};
        }
    }
};
