import axios from 'axios';

// Helper: Fetch a single symbol
async function fetchSymbolCandles(symbol, interval, limit) {
    const sources = [
        { url: 'https://api.binance.com/api/v3/klines', label: 'Global' },
        { url: 'https://api-gcp.binance.com/api/v3/klines', label: 'GCP' },
        { url: 'https://api1.binance.com/api/v3/klines', label: 'API1' }
    ];

    let lastError = null;

    for (const src of sources) {
        try {
            const config = {
                params: { symbol, interval, limit },
                timeout: 8000
            };

            const response = await axios.get(src.url, config);

            if (response.data && Array.isArray(response.data) && response.data.length > 0) {
                return response.data.map(c => ({
                    time: c[0],
                    open: parseFloat(c[1]),
                    high: parseFloat(c[2]),
                    low: parseFloat(c[3]),
                    close: parseFloat(c[4]),
                    volume: parseFloat(c[5])
                }));
            }
        } catch (e) {
            const status = e.response?.status || 'NoStatus';
            console.warn(`[CandleProxy] ${src.label} failed for ${symbol} (${status}): ${e.message}`);
            lastError = `${src.label}: ${e.message}`;
        }
    }
    throw new Error(lastError || 'All candle sources failed');
}

export default async function handler(req, res) {
    const { symbol, interval = '4h', limit = 100 } = req.query;

    if (!symbol) {
        return res.status(400).json({ error: 'Symbol is required' });
    }

    try {
        // BATCH MODE (Comma Separated)
        if (symbol.includes(',')) {
            const symbols = symbol.split(',').filter(s => s.trim().length > 0);

            const promises = symbols.map(async (s) => {
                try {
                    const data = await fetchSymbolCandles(s.trim(), interval, limit);
                    return { symbol: s.trim(), data };
                } catch (e) {
                    console.error(`Batch fail for ${s}:`, e.message);
                    return { symbol: s.trim(), data: [] }; // Fail safe
                }
            });

            const results = await Promise.all(promises);
            // Convert to Map
            const map = results.reduce((acc, item) => {
                acc[item.symbol] = item.data;
                return acc;
            }, {});

            return res.status(200).json(map);
        }

        // SINGLE MODE
        const data = await fetchSymbolCandles(symbol, interval, limit);
        res.status(200).json(data);

    } catch (error) {
        console.error(`Error fetching candles for ${symbol}:`, error.message);
        res.status(500).json({ error: 'Failed to fetch candles', details: error.message });
    }
}
