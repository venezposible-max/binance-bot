import axios from 'axios';
import crypto from 'crypto';
import 'dotenv/config';

const sign = (queryString, secret) => {
    return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
};

async function probeList() {
    console.log('🕵️‍♂️ Probing Lead Trader List Endpoints...');
    const baseUrl = 'https://api.binance.com';
    const key = process.env.BINANCE_API_KEY;
    const secret = process.env.BINANCE_API_SECRET;

    // Potential Endpoints to find the list
    const candidates = [
        '/sapi/v1/copyTrading/futures/leadTraders',
        '/sapi/v1/copyTrading/futures/allLeadTraders',
        '/sapi/v1/portfolio/account', // To check if we are a portfolio margin user
        '/fapi/v1/ticker/24hr' // Public futures data check
    ];

    for (const path of candidates) {
        process.stdout.write(`Testing: ${baseUrl}${path}... `);
        const timestamp = Date.now();
        const query = `timestamp=${timestamp}`;
        const signature = sign(query, secret);

        try {
            const res = await axios.get(`${baseUrl}${path}?${query}&signature=${signature}`, {
                headers: { 'X-MBX-APIKEY': key }
            });
            console.log(`✅ FOUND! Status: ${res.status}`);
            console.log(`   Data Preview: ${JSON.stringify(res.data).substring(0, 100)}`);
        } catch (e) {
            console.log(`❌ FAIL (${e.response?.status} - ${e.response?.statusText})`);
            if (e.response?.status !== 404 && e.response?.status !== 400) {
                console.log(`   Msg: ${e.response?.data?.msg}`);
            }
        }
    }
}

probeList();
