import axios from 'axios';

// Helper to determine base URL based on region
const getBaseUrl = () => {
    const REGION = process.env.REGION || 'US';
    return REGION === 'EU' ? 'https://api.binance.com/api/v3' : 'https://api.binance.us/api/v3';
};

const fetchPriceFromSource = async (baseUrl, symbol) => {
    try {
        const config = {
            params: { symbol },
            timeout: 3000 // Fast timeout to failover quickly
        };
        if (process.env.BINANCE_API_KEY) {
            config.headers = { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY };
        }
        const response = await axios.get(`${baseUrl}/ticker/price`, config);
        return parseFloat(response.data.price);
    } catch (e) {
        return null;
    }
};

export default async function handler(req, res) {
    const { symbols } = req.query; // Comma separated symbols

    if (!symbols) {
        return res.status(400).json({ error: 'Symbols parameter is required' });
    }

    const symbolArray = symbols.split(',');
    const prices = {};

    // Sources Loop (Global Only)
    // 1. GCP Mirror (Fastest)
    // 2. Global Main (Backup)
    // 3. Alt Mirror (Backup)
    const sources = [
        'https://api-gcp.binance.com/api/v3/ticker/price',
        'https://api.binance.com/api/v3/ticker/price',
        'https://api1.binance.com/api/v3/ticker/price'
    ];

    try {
        const promises = symbolArray.map(async (s) => {
            let price = null;

            for (const src of sources) {
                try {
                    const res = await axios.get(src, {
                        params: { symbol: s }, // Pass symbol parameter!
                        timeout: 3000
                    });
                    if (res.data && res.data.price) {
                        price = parseFloat(res.data.price);
                        break; // Found it!
                    }
                } catch (e) {
                    // Continue to next source
                }
            }

            return { symbol: s, price };
        });

        const results = await Promise.all(promises);
        results.forEach(r => {
            if (r && r.price) prices[r.symbol] = r.price;
        });

        res.status(200).json(prices);
    } catch (error) {
        console.error('Ticker Error:', error.message);
        res.status(200).json({}); // Return empty object instead of crash, let frontend handle it
    }
}
