
import redis from './utils/redisClient.js';

export default async function handler(req, res) {
    const { symbol } = req.query;

    if (!symbol) {
        return res.status(400).json({ error: 'Symbol query parameter is required (e.g. ?symbol=PEPE)' });
    }

    const targetSymbol = symbol.toUpperCase().trim();
    console.log(`🧹 ADMIN: Removing trade for symbol: ${targetSymbol}`);

    try {
        const keysToCheck = [
            'sentinel_active_trades',
            'sentinel_active_trades_sim',
            'sentinel_active_trades_real',
            'sentinel_sniper_trades',
            'sentinel_sniper_trades_sim',
            'sentinel_sniper_trades_real'
        ];

        let totalDeleted = 0;
        let details = [];

        for (let key of keysToCheck) {
            const raw = await redis.get(key);
            if (!raw) continue;

            let trades = [];
            try {
                trades = JSON.parse(raw);
            } catch (e) { continue; }

            if (!Array.isArray(trades)) continue;

            const initialCount = trades.length;

            // Filter out the ghost trade
            const keptTrades = trades.filter(t => !t.symbol.includes(targetSymbol));

            const removedCount = initialCount - keptTrades.length;

            if (removedCount > 0) {
                totalDeleted += removedCount;
                details.push(`${removedCount} removed from ${key}`);
                await redis.set(key, JSON.stringify(keptTrades));
                // Force a scanner refresh
                await redis.del('sentinel_active_pairs');
            }
        }

        if (totalDeleted > 0) {
            return res.json({
                success: true,
                message: `✅ Removed ${totalDeleted} trade(s) for ${targetSymbol}.`,
                details
            });
        } else {
            return res.json({
                success: false,
                message: `No active trades found for ${targetSymbol}.`
            });
        }

    } catch (error) {
        console.error('Remove Trade Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
