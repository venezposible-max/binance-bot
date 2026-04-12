import redisClient from './utils/redisClient.js';

export default async function handler(req, res) {
    try {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

        const { orderNo, bankName } = req.body;
        if (!orderNo) return res.status(400).json({ error: 'orderNo es requerido' });

        const tagsStr = await redisClient.get('fiat_order_tags');
        let orderTags = tagsStr ? JSON.parse(tagsStr) : {};

        if (bankName === null || bankName === '') {
            delete orderTags[orderNo];
        } else {
            orderTags[orderNo] = bankName;
        }

        await redisClient.set('fiat_order_tags', JSON.stringify(orderTags));

        res.status(200).json({ success: true, orderNo, bankName });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
