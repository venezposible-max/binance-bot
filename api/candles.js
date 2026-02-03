import axios from 'axios';

export default async function handler(req, res) {
    const { symbol, interval = '4h', limit = 100 } = req.query;

    if (!symbol) {
        return res.status(400).json({ error: 'Symbol is required' });
    }

    try {
        const sources = [
            { url: 'https://api.binance.com/api/v3/klines', label: 'Global' },
            { url: 'https://api-gcp.binance.com/api/v3/klines', label: 'GCP' },
            { url: 'https://api1.binance.com/api/v3/klines', label: 'API1' }
        ];

        let response = null;
        let lastError = null;

        for (const src of sources) {
            try {
                const config = {
                    params: { symbol, interval, limit },
                    timeout: 8000
                };
                // REMOVED: API Key for public klines. sending a US Key to Global API causes 401/403 errors.
                // config.headers = { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY };

                // console.log(`Candles: Trying ${src.label} for ${symbol}...`);
                response = await axios.get(src.url, config);

                if (response.data && Array.isArray(response.data) && response.data.length > 0) {
                    break; // Success
                }
            } catch (e) {
                const status = e.response?.status || 'NoStatus';
                console.warn(`[CandleProxy] ${src.label} failed for ${symbol} (${status}): ${e.message}`);
                lastError = `${src.label}: ${e.message}`;
            }
        }

        if (!response || !response.data) {
            throw new Error(lastError || 'All candle sources failed');
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
