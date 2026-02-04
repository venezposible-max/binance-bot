
import redis from './api/utils/redisClient.js';

async function check() {
    try {
        const mode = await redis.get('sentinel_active_mode');
        const sims = await redis.get('sentinel_active_trades_sim');
        const reals = await redis.get('sentinel_active_trades_real');

        console.log('--- DEBUG REPORT ---');
        console.log('MODE:', mode);
        console.log('SIM TRADES:', sims ? JSON.parse(sims).map(t => t.symbol) : []);
        console.log('REAL TRADES:', reals ? JSON.parse(reals).map(t => t.symbol) : []);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

check();
