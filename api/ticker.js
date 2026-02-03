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
        return res.status(400).json({ error: 'Symbols required' });
    }

    const symbolList = symbols.split(',');
    const prices = {};

    // URLS
    const BINANCE_US = 'https://api.binance.us/api/v3';
    const BINANCE_GLOBAL = 'https://api.binance.com/api/v3';

    try {
        const promises = symbolList.map(async (s) => {
            // STRATEGY: Robust Multi-Source Fetch (Global -> GCP -> API1)
            // Removed Binance US to prevent "Symbol Not Found" for global pairs like ZAMA
            const sources = [
                { url: `https://api.binance.com/api/v3/ticker/price?symbol=${s}`, label: 'Global' },
                { url: `https://api-gcp.binance.com/api/v3/ticker/price?symbol=${s}`, label: 'GCP' },
                { url: `https://api1.binance.com/api/v3/ticker/price?symbol=${s}`, label: 'API1' }
            ];

            let price = null;

            for (const src of sources) {
                try {
                    const res = await axios.get(src.url, { timeout: 3000 });
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
