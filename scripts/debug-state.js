import 'dotenv/config';
import redis from '../api/utils/redisClient.js';

async function main() {
    console.log('🔍 INSPECTING REDIS STATE...');

    // Check REAL Active Trades
    const activeReal = await redis.get('sentinel_active_trades_real');
    console.log('\n--- LIVE TRADES (sentinel_active_trades_real) ---');
    console.log(activeReal ? JSON.stringify(JSON.parse(activeReal), null, 2) : 'NONE');

    // Check REAL Wallet Config
    const configReal = await redis.get('sentinel_wallet_config_real');
    console.log('\n--- LIVE CONFIG (sentinel_wallet_config_real) ---');
    console.log(configReal ? JSON.stringify(JSON.parse(configReal), null, 2) : 'NONE');

    // Check if there are any SIM trades leaking?
    const activeSim = await redis.get('sentinel_active_trades_sim');
    console.log('\n--- SIM TRADES (for reference) ---');
    console.log(activeSim ? JSON.stringify(JSON.parse(activeSim), null, 2) : 'NONE');

    process.exit(0);
}

main();
