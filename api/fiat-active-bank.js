import redisClient from './utils/redisClient.js';

export default async function handler(req, res) {
    try {
        if (req.method === 'GET') {
            const activeBank = await redisClient.get('active_fiat_bank');
            return res.status(200).json({ activeBank });
        }

        if (req.method === 'POST') {
            const { bankName } = req.body; // "BDV", "Bancamiga", "TESORO", or null
            if (bankName === null || bankName === '') {
                await redisClient.del('active_fiat_bank');
                return res.status(200).json({ success: true, activeBank: null });
            }

            await redisClient.set('active_fiat_bank', bankName);
            return res.status(200).json({ success: true, activeBank: bankName });
        }

        res.status(405).json({ error: 'Method Not Allowed' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
