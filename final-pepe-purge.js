
import redis from './api/utils/redisClient.js';

async function finalCleanup() {
    console.log('🚀 Starting Final PEPE Purge...');

    // 1. Clear Cached Pairs so the scan list is updated immediately
    await redis.del('sentinel_active_pairs');
    console.log('✅ Cleared sentinel_active_pairs (force refresh).');

    // 2. Clear all Trade keys
    const keysToCheck = [
        'sentinel_active_trades',
        'sentinel_active_trades_sim',
        'sentinel_active_trades_real',
        'sentinel_sniper_trades',
        'sentinel_sniper_trades_sim',
        'sentinel_sniper_trades_real'
    ];

    for (let key of keysToCheck) {
        const raw = await redis.get(key);
        if (!raw) continue;

        let trades = [];
        try {
            trades = JSON.parse(raw);
        } catch (e) { continue; }

        if (!Array.isArray(trades)) continue;

        const filtered = trades.filter(t => !t.symbol.includes('PEPE'));
        if (filtered.length !== trades.length) {
            console.log(`🛠️ [${key}] Found PEPE. Removing ${trades.length - filtered.length} trade(s)...`);
            await redis.set(key, JSON.stringify(filtered));
        }
    }

    console.log('✅ Final Purge Complete.');
    process.exit(0);
}

finalCleanup();
