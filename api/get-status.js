import redis from '../src/utils/redisClient.js';

export default async function handler(req, res) {
    try {
        const activeMode = await redis.get('sentinel_active_mode') || 'SIMULATION';
        const suffix = activeMode === 'LIVE' ? '_real' : '_sim';

        const activeKey = `sentinel_active_trades${suffix}`;
        const historyKey = `sentinel_win_history${suffix}`;
        const sniperKey = `sentinel_sniper_trades${suffix}`;

        let activeTradesStr = await redis.get(activeKey);
        let winHistoryStr = await redis.get(historyKey);
        let sniperTradesStr = await redis.get(sniperKey);

        // FALLBACK: If new keys don't exist, try loading from old keys (Migration)
        // We only do this for SIM mode as it's the safest assumption for old data
        if (activeMode === 'SIMULATION' && !activeTradesStr) {
            const oldActive = await redis.get('sentinel_active_trades');
            if (oldActive) {
                activeTradesStr = oldActive;
                await redis.set(activeKey, oldActive);
            }
            const oldHistory = await redis.get('sentinel_win_history');
            if (oldHistory) {
                winHistoryStr = oldHistory;
                await redis.set(historyKey, oldHistory);
            }
        }

        const activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
        const winHistory = winHistoryStr ? JSON.parse(winHistoryStr) : [];
        const sniperTrades = sniperTradesStr ? JSON.parse(sniperTradesStr) : [];

        // Merge Sniper trades with standard trades
        const allActiveTrades = [...activeTrades, ...sniperTrades];

        res.status(200).json({
            active: allActiveTrades,
            history: winHistory,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching cloud status:', error);
        res.status(500).json({ error: 'Failed to fetch cloud status' });
    }
}
