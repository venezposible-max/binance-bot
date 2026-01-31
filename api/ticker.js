import axios from 'axios';

// Helper to determine base URL based on region
const getBaseUrl = () => {
    const REGION = process.env.REGION || 'US';
    return REGION === 'EU' ? 'https://api.binance.com/api/v3' : 'https://api.binance.us/api/v3';
};

const fetchPriceFromSource = async (baseUrl, symbol) => {
    try {
        const response = await axios.get(`${baseUrl}/ticker/price`, {
            params: { symbol },
            timeout: 3000 // Fast timeout to failover quickly
        });
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
            // STRATEGY: Try Preferred Region First -> Then Failover
            const preferredUrl = getBaseUrl();
            const backupUrl = preferredUrl.includes('.us') ? BINANCE_GLOBAL : BINANCE_US;

            let price = await fetchPriceFromSource(preferredUrl, s);

            if (!price) {
                // Failover attempt
                // console.log(`Price failover for ${s}`);
                price = await fetchPriceFromSource(backupUrl, s);
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
