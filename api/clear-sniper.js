import redis from '../src/utils/redisClient.js';

export default async function handler(req, res) {
    try {
        // Clear all Sniper trades
        await redis.set('sentinel_sniper_trades', JSON.stringify([]));

        res.status(200).json({
            success: true,
            message: 'All Sniper trades cleared'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
