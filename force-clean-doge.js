
import redis from './api/utils/redisClient.js';

async function clean() {
    const KEY = 'sentinel_active_trades_real';
    try {
        console.log('🧹 Cleaning Ghost Trades from LIVE...');
        const raw = await redis.get(KEY);
        if (!raw) {
            console.log('✅ No active trades found.');
            process.exit(0);
        }

        const trades = JSON.parse(raw);
        console.log(`🧐 Found ${trades.length} active trades.`);

        const initialLength = trades.length;
        // Filter out DOGEUSDT
        const cleanTrades = trades.filter(t => t.symbol !== 'DOGEUSDT');

        if (cleanTrades.length < initialLength) {
            await redis.set(KEY, JSON.stringify(cleanTrades));
            console.log(`✅ OBLITERATED ${initialLength - cleanTrades.length} DOGEUSDT trades.`);
        } else {
            console.log('⚠️ No DOGEUSDT found to delete.');
        }

        process.exit(0);

    } catch (e) {
        console.error('❌ Error cleaning:', e);
        process.exit(1);
    }
}

clean();
