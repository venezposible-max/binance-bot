import 'dotenv/config';
import binanceClient from '../api/utils/binance-client.js';

async function main() {
    console.log('🔍 FULL WALLET AUDIT (Checking ALL Coins)...');
    try {
        const account = await binanceClient.getAccountBalance('ALL');

        console.log('------------------------------------------------');
        console.log(`✅ ACCOUNT PERMISSIONS: ${JSON.stringify(account.permissions)}`);
        console.log(`✅ ACCOUNT TYPE: ${account.accountType}`);
        console.log('------------------------------------------------');
        console.log('💰 NON-ZERO BALANCES:');

        const nonZero = account.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);

        if (nonZero.length === 0) {
            console.log('   (No funds found)');
        }

        nonZero.forEach(b => {
            console.log(`   - ${b.asset}:  Free=${b.free}  Locked=${b.locked}`);
        });
        console.log('------------------------------------------------');

    } catch (e) {
        console.error('❌ ERROR:', e.message);
    }
}

main();
