import 'dotenv/config';
import redis from './src/utils/redisClient.js';

async function clearLive() {
    console.log('🧹 Clearing LIVE Active Trades...');
    // Delete the key holding the "Fake" trades
    await redis.del('sentinel_active_trades_real');

    // Also clear SIM just in case
    await redis.del('sentinel_active_trades_sim');

    console.log('✅ Live data wiped. Bot will now Auto-Sync from real Binance balances on next run.');
    process.exit(0);
}

clearLive();
