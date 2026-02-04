import redis from './utils/redisClient.js';

export default async function handler(req, res) {
    try {
        const activeMode = await redis.get('sentinel_active_mode') || 'SIMULATION';
        const suffix = activeMode === 'LIVE' ? '_real' : '_sim';
        const lockdownStr = await redis.get('sentinel_lockdown');

        // Check API Keys env vars (Masked for security)
        const isApiConfigured = !!(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET);

        const activeKey = `sentinel_active_trades${suffix}`;
        const historyKey = `sentinel_win_history${suffix}`;

        const activeTradesStr = await redis.get(activeKey);
        const winHistoryStr = await redis.get(historyKey);

        const activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
        const winHistory = winHistoryStr ? JSON.parse(winHistoryStr) : [];

        // Merge Sniper trades (REMOVED) with standard trades
        const allActiveTrades = [...activeTrades];

        res.status(200).json({
            active: allActiveTrades,
            history: winHistory,
            timestamp: new Date().toISOString(),
            lockdown: lockdownStr === 'true', // NEW
            isApiConfigured, // NEW
            mode: activeMode
        });
    } catch (error) {
        console.error('Error fetching cloud status:', error);
        res.status(500).json({ error: 'Failed to fetch cloud status' });
    }
}
