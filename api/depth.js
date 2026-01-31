import axios from 'axios';

export default async function handler(req, res) {
    const { symbol, limit = 50 } = req.query;

    if (!symbol) {
        return res.status(400).json({ error: 'Symbol is required' });
    }

    const REGION = process.env.REGION || 'US';

    try {
        let response;
        // Prioritize Binance US for typical Vercel/Railway regions, Fallback to Global
        // The endpoint is /api/v3/depth

        const config = {
            params: { symbol, limit },
            timeout: 5000
        };

        // If VIP Keys are present, use them for higher rate limits (on Global)
        if (process.env.BINANCE_API_KEY) {
            config.headers = { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY };
        }

        if (REGION === 'EU') {
            // EU Mode: Direct Global
            response = await axios.get('https://api.binance.com/api/v3/depth', config);
        } else {
            // US Mode: Try US first
            try {
                // Note: Binance US might not accept standard API Keys if they are Global keys?
                // Usually keys are specific. But user likely has Global keys if they ask for "Binance".
                // Safest bet: Try US without keys first (public), or Global WITH keys if fallback.

                // Let's try US Public first for speed/safety
                response = await axios.get('https://api.binance.us/api/v3/depth', {
                    params: { symbol, limit },
                    timeout: 4000
                });
            } catch (e) {
                console.warn(`Binance US Depth failed for ${symbol}, trying Global Proxy...`);
                // Fallback to Global (Works via backend even if browser blocked)
                response = await axios.get('https://api.binance.com/api/v3/depth', config);
            }
        }

        // Return raw Bids/Asks
        // Format: { lastUpdateId: 123, bids: [ [price, qty], ... ], asks: [ ... ] }
        res.status(200).json(response.data);

    } catch (error) {
        console.error(`Error fetching depth for ${symbol}:`, error.message);
        res.status(500).json({ error: 'Failed to fetch depth', details: error.message });
    }
}
