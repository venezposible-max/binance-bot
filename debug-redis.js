
import Redis from 'ioredis';
import axios from 'axios';

const redis = new Redis(process.env.REDIS_URL);
const TOP_PAIRS = ['BCHUSDT', 'FILUSDT', 'LINKUSDT', 'BTCUSDT'];

async function debug() {
    console.log("🔍 INSPECTING REDIS STATE...");

    // 1. Get Trades
    const tradesStr = await redis.get('sentinel_active_trades');
    const trades = tradesStr ? JSON.parse(tradesStr) : [];
    console.log(`📂 Found ${trades.length} active trades.`);

    for (const t of trades) {
        if (!TOP_PAIRS.includes(t.symbol)) continue; // Focus on problem coins

        console.log(`\n------------------------------------------------`);
        console.log(`🪙 SYMBOL: ${t.symbol}`);
        console.log(`   ID: ${t.id}`);
        console.log(`   Strategy: ${t.strategy || 'N/A'}`);
        console.log(`   Entry Price (Redis): $${t.entryPrice}`);
        console.log(`   Created At: ${t.timestamp}`);

        // 2. Fetch Price (Mocking Backend Logic)
        try {
            // SCALP logic uses 5m
            const interval = (t.strategy === 'SCALP') ? '5m' : '4h';
            const url = `https://api.binance.us/api/v3/klines?symbol=${t.symbol}&interval=${interval}&limit=5`;
            const { data } = await axios.get(url);
            const close = parseFloat(data[data.length - 1][4]);

            console.log(`   Current Price (${interval}): $${close}`);

            // Calc PnL
            let pnl = ((close - t.entryPrice) / t.entryPrice) * 100;
            console.log(`   CALCULATED PnL: ${pnl.toFixed(4)}%`);

            if (pnl === 0) console.log("   ⚠️ PNL IS EXACTLY ZERO - SUSPICIOUS");

        } catch (e) {
            console.log(`   ❌ Price Fetch Failed: ${e.message}`);
        }
    }

    process.exit(0);
}

debug();
