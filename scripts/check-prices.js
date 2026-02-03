import 'dotenv/config';
import axios from 'axios';

async function main() {
    console.log('🔍 CHECKING ASSET VALUES...');

    // Assets from the audit
    const assets = [
        { symbol: 'PUMP', amount: 6680 },
        { symbol: 'ETHW', amount: 0.0946 },
        { symbol: 'BNB', amount: 0.001 } // Small dust
    ];

    let totalValue = 0;

    for (const asset of assets) {
        const pair = `${asset.symbol}USDT`;
        try {
            // Try standard Binance API
            const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`);
            const price = parseFloat(res.data.price);
            const value = price * asset.amount;
            totalValue += value;
            console.log(`✅ ${asset.symbol}: Price $${price} * ${asset.amount} = $${value.toFixed(2)}`);
        } catch (e) {
            console.warn(`⚠️ Could not get price for ${pair} (Not listed on Binance Spot?): ${e.message}`);
            // Fallback?
        }
    }

    console.log('---------------------------');
    console.log(`💰 ESTIMATED ALTCOIN VALUE: $${totalValue.toFixed(2)}`);
}

main();
