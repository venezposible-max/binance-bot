import 'dotenv/config'; // Load .env
import binanceClient from '../api/utils/binance-client.js';

async function main() {
    console.log('🔍 Checking Binance Balance for USDT...');
    try {
        const balance = await binanceClient.getAccountBalance('USDT');
        console.log('--------------------------------');
        console.log('RAW RESULT:', JSON.stringify(balance, null, 2));
        console.log('--------------------------------');
        console.log(`✅ Available: ${balance.available}`);
        console.log(`🔒 Locked:    ${balance.locked}`);
        console.log(`💰 TOTAL:     ${balance.total}`);
    } catch (e) {
        console.error('❌ ERROR:', e.message);
        if (e.response) console.error('Response:', e.response.data);
    }
}

main();
