import 'dotenv/config'; // Load .env
import redis from './api/utils/redisClient.js';

async function checkReal() {
    console.log('--- CHECKING REAL TRADES ---');
    const trades = await redis.get('sentinel_active_trades_real');
    if (!trades) {
        console.log('No active REAL trades found.');
    } else {
        const parsed = JSON.parse(trades);
        console.log(`Found ${parsed.length} active REAL trades.`);
        parsed.forEach(t => {
            console.log(`- [${t.symbol}] Entry: $${t.entryPrice} | Time: ${t.timestamp} | ID: ${t.id}`);
        });
    }
    process.exit();
}

checkReal();
