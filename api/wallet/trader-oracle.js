import redis from '../utils/redisClient.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    try {
        const dataStr = await redis.get('sentinel_trader_oracle');
        if (!dataStr) {
            return res.status(200).json({
                name: "Scanning...",
                roi90d: 0,
                mdd: 0,
                winRate: 0,
                message: "Awaiting first scan cycle"
            });
        }

        res.status(200).json(JSON.parse(dataStr));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
