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
        const response = await axios.get(`${BASE_URL}/klines`, {
            params: {
                symbol,
                interval,
                limit
            }
        });

        // Binance format: [open_time, open, high, low, close, volume, ...]
        // We mainly need Close prices for RSI
        return response.data.map(c => ({
            time: c[0],
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5])
        }));
    } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error);
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
