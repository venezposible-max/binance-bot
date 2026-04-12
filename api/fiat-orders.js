import crypto from 'crypto';
import axios from 'axios';
import redisClient from './utils/redisClient.js';

export default async function handler(req, res) {
    try {
        const apiKey = process.env.BINANCE_API_KEY;
        const apiSecret = process.env.BINANCE_API_SECRET;
        
        if (!apiKey || !apiSecret) {
            return res.status(401).json({ error: 'API Keys no configuradas' });
        }

        // --- GET ACTIVE BANK SETTING ---
        const activeBank = await redisClient.get('active_fiat_bank'); // e.g. "BDV", "Bancamiga", null
        const tagsStr = await redisClient.get('fiat_order_tags');
        let orderTags = tagsStr ? JSON.parse(tagsStr) : {};

        const baseURL = 'https://api.binance.com';
        const endpoint = '/sapi/v1/fiat/orders';
        const timestamp = Date.now();
        
        const queryString = `transactionType=0&rows=500&timestamp=${timestamp}`;
        const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
        const url = `${baseURL}${endpoint}?${queryString}&signature=${signature}`;

        const response = await axios.get(url, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });

        const orders = response.data.data || [];
        let hasNewTags = false;

        // --- LIVE TAGGING LOGIC ---
        const taggedOrders = orders.map(order => {
            const orderNo = order.orderNo;
            
            // If already tagged in history, use that
            if (orderTags[orderNo]) {
                return { ...order, customBank: orderTags[orderNo] };
            }

            // If NOT tagged, but there's an ACTIVE bank right now AND transaction is recent (last 30 mins)
            // Note: We only tag if Successful to avoid tagging old failures.
            const isRecent = (Date.now() - order.updateTime) < (45 * 60 * 1000); // 45 min window
            
            if (activeBank && isRecent) {
                orderTags[orderNo] = activeBank;
                hasNewTags = true;
                return { ...order, customBank: activeBank };
            }

            return { ...order, customBank: 'Sin Etiqueta' };
        });

        // Persist tags if updated
        if (hasNewTags) {
            await redisClient.set('fiat_order_tags', JSON.stringify(orderTags));
        }

        res.status(200).json({
            success: true,
            activeBank,
            data: taggedOrders
        });

    } catch (error) {
        console.error('Fiat API Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: error.message });
    }
}
