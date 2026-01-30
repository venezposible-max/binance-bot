import axios from 'axios';
import { getBaseUrl } from '../src/utils/config.js';

export default async function handler(req, res) {
    const { symbols } = req.query; // Comma separated symbols: "BTCUSDT,ETHUSDT"

    if (!symbols) {
        return res.status(400).json({ error: 'Symbols required' });
    }

    const symbolList = symbols.split(',');
    const prices = {};

    try {
        const BASE_URL = getBaseUrl();
        // Use ticker/price for real-time accuracy (better than kline close)
        // We can fetch all at once or one by one. For efficiency, fetching all is better but huge payload.
        // Binance specific: /api/v3/ticker/price?symbol=xxx or all if no symbol.
        // We will fetch specific ones in parallel.

        const promises = symbolList.map(async (s) => {
            try {
                const response = await axios.get(`${BASE_URL}/ticker/price`, {
                    params: { symbol: s },
                    timeout: 5000
                });
                return { symbol: s, price: parseFloat(response.data.price) };
            } catch (e) {
                console.warn(`Failed to fetch price for ${s}:`, e.message);
                return null;
            }
        });

        const results = await Promise.all(promises);
        results.forEach(r => {
            if (r) prices[r.symbol] = r.price;
        });

        res.status(200).json(prices);
    } catch (error) {
        console.error('Ticker Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch prices' });
    }
}
