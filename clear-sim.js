import redis from './src/utils/redisClient.js';

async function clearSim() {
    console.log('🧹 Clearing Simulation Keys...');
    await redis.del('sentinel_active_trades_sim');
    await redis.del('sentinel_win_history_sim');
    console.log('✅ Simulation data wiped.');
    process.exit(0);
}

clearSim();
