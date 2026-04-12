import crypto from 'crypto';
import axios from 'axios';

export default async function handler(req, res) {
    try {
        const apiKey = process.env.BINANCE_API_KEY;
        const apiSecret = process.env.BINANCE_API_SECRET;
        
        if (!apiKey || !apiSecret) {
            return res.status(401).json({ error: 'API Keys no configuradas' });
        }

        const baseURL = 'https://api.binance.com';
        const endpoint = '/sapi/v1/fiat/orders';
        const timestamp = Date.now();
        
        // Fetch up to 500 rows, transactionType=0 (buy)
        const queryString = `transactionType=0&rows=500&timestamp=${timestamp}`;
        const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
        const url = `${baseURL}${endpoint}?${queryString}&signature=${signature}`;

        const response = await axios.get(url, {
            headers: {
                'X-MBX-APIKEY': apiKey
            }
        });

        res.status(200).json(response.data);
    } catch (error) {
        console.error('Fiat API Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: error.message });
    }
}
