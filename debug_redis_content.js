
import redis from './api/utils/redisClient.js';

async function checkTrades() {
    const tradesStr = await redis.get('sentinel_active_trades_real');
    console.log('--- ACTIVE TRADES (REAL) ---');
    console.log(tradesStr);
    process.exit(0);
}

checkTrades();
