import axios from 'axios';

export default async function handler(req, res) {
    const { symbol, interval = '4h', limit = 100 } = req.query;

    if (!symbol) {
        return res.status(400).json({ error: 'Symbol is required' });
    }

    const REGION = process.env.REGION || 'US';

    try {
        let response;

        if (REGION === 'EU') {
            // Priority: Binance Global
            response = await axios.get('https://api.binance.com/api/v3/klines', {
                params: { symbol, interval, limit },
                timeout: 8000
            });
        } else {
            // US Mode: Try Binance US first
            try {
                response = await axios.get('https://api.binance.us/api/v3/klines', {
                    params: { symbol, interval, limit },
                    timeout: 5000
                });
            } catch (e) {
                console.warn(`Binance US failed for ${symbol}, trying Global...`);
                response = await axios.get('https://api.binance.com/api/v3/klines', {
                    params: { symbol, interval, limit },
                    timeout: 8000
                });
            }
        }

        // Transform to frontend format
        const candles = response.data.map(c => ({
            time: c[0],
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5])
        }));

        res.status(200).json(candles);
    } catch (error) {
        console.error(`Error fetching candles for ${symbol}:`, error.message);
        res.status(500).json({ error: 'Failed to fetch candles', details: error.message });
    }
}
