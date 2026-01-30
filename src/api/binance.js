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
