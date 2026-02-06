import redis from './utils/redisClient.js';

export default async function handler(req, res) {
    try {
        const storedMode = await redis.get('sentinel_active_mode');
        const activeMode = req.query.mode || storedMode || 'SIMULATION';
        const suffix = activeMode === 'LIVE' ? '_real' : '_sim';
        const lockdownStr = await redis.get('sentinel_lockdown');

        // Check API Keys env vars (Masked for security)
        const isApiConfigured = !!(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET);

        const activeKey = `sentinel_active_trades${suffix}`;
        const historyKey = `sentinel_win_history${suffix}`;

        const activeTradesStr = await redis.get(activeKey);
        const winHistoryStr = await redis.get(historyKey);

        let activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
        let history = winHistoryStr ? JSON.parse(winHistoryStr) : [];

        // 💀 PAIN MEMORY: Fetch blacklist (Mode Specific)
        const blacklistKeys = await redis.keys(`blacklist_${activeMode}:*`);
        const blacklist = blacklistKeys.map(k => k.split(':')[1]);

        // 🛡️ SELF-HEALING HISTORY (PnL Fix)
        let fixNeeded = false;
        history = history.map(h => {
            if (h.type === 'LONG' && h.exitPrice > h.entryPrice && h.pnl < 0) {
                h.pnl = ((h.exitPrice - h.entryPrice) / h.entryPrice) * 100;
                if (h.profitUsd < 0) h.profitUsd = Math.abs(h.profitUsd); // Rough fix for USD too
                fixNeeded = true;
            }
            return h;
        });

        // Async Save if needed (Don't await to keep UI fast)
        if (fixNeeded) {
            redis.set(historyKey, JSON.stringify(history)).catch(e => console.error("History Auto-Fix Save Error:", e));
        }

        // Merge Sniper trades (REMOVED) with standard trades
        const allActiveTrades = [...activeTrades];

        res.status(200).json({
            active: allActiveTrades,
            history: history,
            timestamp: new Date().toISOString(),
            lockdown: lockdownStr === 'true', // NEW
            isApiConfigured, // NEW
            mode: activeMode,
            blacklist
        });
    } catch (error) {
        console.error('Error fetching cloud status:', error);
        res.status(500).json({ error: 'Failed to fetch cloud status' });
    }
}
