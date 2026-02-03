import axios from 'axios';

export default async function handler(req, res) {
    const { symbol, limit = 50 } = req.query;

    if (!symbol) {
        return res.status(400).json({ error: 'Symbol is required' });
    }

    const REGION = process.env.REGION || 'US';

    try {
        // Prioritize Binance US for typical Vercel/Railway regions, Fallback to Global
        // The endpoint is /api/v3/depth

        const sources = [
            { url: 'https://api.binance.com/api/v3/depth', label: 'Global' },
            { url: 'https://api-gcp.binance.com/api/v3/depth', label: 'GCP' },
            { url: 'https://api1.binance.com/api/v3/depth', label: 'API1' }
        ];

        let response = null;

        for (const src of sources) {
            try {
                // console.log(`Depth: Trying ${src.label} for ${symbol}...`);
                response = await axios.get(src.url, {
                    params: { symbol, limit },
                    timeout: 4000
                });
                if (response.data && response.data.bids) break;
            } catch (e) {
                // console.warn(`Depth: ${src.label} failed for ${symbol}`);
            }
        }

        if (!response || !response.data) throw new Error('All depth sources failed');

        // Return raw Bids/Asks
        // Format: { lastUpdateId: 123, bids: [ [price, qty], ... ], asks: [ ... ] }
        res.status(200).json(response.data);

    } catch (error) {
        console.error(`Error fetching depth for ${symbol}:`, error.message);
        res.status(500).json({ error: 'Failed to fetch depth', details: error.message });
    }
}
