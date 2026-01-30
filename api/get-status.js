import redis from '../src/utils/redisClient.js';

export default async function handler(req, res) {
    try {
        const activeTradesStr = await redis.get('sentinel_active_trades');
        const winHistoryStr = await redis.get('sentinel_win_history');

        const activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
        const winHistory = winHistoryStr ? JSON.parse(winHistoryStr) : [];

        res.status(200).json({
            active: activeTrades,
            history: winHistory,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching cloud status:', error);
        res.status(500).json({ error: 'Failed to fetch cloud status' });
    }
}
