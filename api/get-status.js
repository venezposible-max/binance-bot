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
        const btcChangeStr = await redis.get('sentinel_btc_change');

        let activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
        let history = winHistoryStr ? JSON.parse(winHistoryStr) : [];
        let btcChange = btcChangeStr ? parseFloat(btcChangeStr) : null;

        // 💀 PAIN MEMORY: Disabled
        const blacklist = [];

        // 🛡️ SELF-HEALING HISTORY (PnL Fix & Unixa Strategy Label Fix)
        let fixNeeded = false;
        history = history.map(h => {
            // FIX 1: PnL flip error
            if (h.type === 'LONG' && h.exitPrice > h.entryPrice && h.pnl < 0) {
                h.pnl = ((h.exitPrice - h.entryPrice) / h.entryPrice) * 100;
                if (h.profitUsd < 0) h.profitUsd = Math.abs(h.profitUsd);
                fixNeeded = true;
            }

            // FIX 2: Strategy Labels (Migrate recently mislabeled VORTEX to UNIXA)
            // If the exitReason contains UNIXA (e.g. UNIXA_TIMEOUT) but strategy says VORTEX, fix it.
            // Also, since the user explicitly asked to "fix the old ones", and we know Unixa was just running:
            if ((h.strategy === 'VORTEX' || h.strategy === 'VORTEX+HYBRID') &&
                (h.exitReason?.includes('UNIXA') || h.exitReason === 'TP_HIT' || h.exitReason === 'GLOBAL_TP_HIT')) {
                // If it was a TP hit during Unixa testing, labeling it UNIXA is safer now.
                // We apply this only to very recent trades (past 24h) to avoid breaking real old Vortex trades.
                const tradeTime = new Date(h.timestamp).getTime();
                const now = Date.now();
                if ((now - tradeTime) < 86400000) { // Last 24 hours migration
                    h.strategy = 'UNIXA';
                    fixNeeded = true;
                }
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
            btcChange, // NEW: For BTC Guard UI
            mode: activeMode,
            blacklist
        });
    } catch (error) {
        console.error('Error fetching cloud status:', error);
        res.status(500).json({ error: 'Failed to fetch cloud status' });
    }
}
