import redis from '../utils/redisClient.js';

export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            const mode = await redis.get('sentinel_active_mode') || 'SIMULATION';
            res.status(200).json({ mode });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    } else if (req.method === 'POST') {
        try {
            const { mode } = req.body;
            if (mode !== 'SIMULATION' && mode !== 'LIVE') {
                return res.status(400).json({ error: 'Invalid mode' });
            }
            await redis.set('sentinel_active_mode', mode);
            res.status(200).json({ success: true, mode });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    } else {
        res.setHeader('Allow', ['GET', 'POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}
