
import axios from 'axios';
import { EMA } from 'technicalindicators';

async function backtest() {
    console.log('📉 BACKTESTING BTC CRASH (24H) - BLITZ vs GREEN-FILTER');

    // 1. Fetch Data (120 Days Ago + History Buffer)
    const now = Date.now();
    const hundredTwentyDaysAgo = now - (120 * 24 * 60 * 60 * 1000);
    // No need for 'dayBefore' because we fetch limit=1000

    console.log(`📅 Testing Date: ${new Date(hundredTwentyDaysAgo).toLocaleDateString()} (Hybrid Learning)`);

    const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=1000&endTime=${hundredTwentyDaysAgo}`);
    const candles = res.data.map(c => ({
        time: new Date(c[0]).toLocaleTimeString(),
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4])
    }));

    let walletA = 1000; // Original
    let walletB = 1000; // With Green Filter

    let tradesA = 0, tradesB = 0;
    let winsA = 0, winsB = 0;

    // MEMORY DB 🧠
    let memory = {};

    // Simulation Loop
    // We need at least 50 candles for EMA
    for (let i = 50; i < candles.length - 1; i++) {
        const current = candles[i];
        const prev = candles[i - 1];
        const next = candles[i + 1]; // The 'Future' result

        // CALCULATE INDICATORS
        const sliced = candles.slice(0, i + 1).map(c => c.close);
        const ema200 = EMA.calculate({ period: 50, values: sliced }).pop(); // Using 50 here for reactivity in 5m

        // BASIC BLITZ LOGIC (Simplified)
        // Buy if sudden drop near EMA or Oversold logic
        const drop = ((prev.close - current.close) / prev.close) * 100;
        const isDip = drop > 0.3; // Small dip check
        const isCheap = current.close < ema200; // Below trend (falling)

        // TRIGGER
        if (isDip && isCheap) {

            // STRATEGY A (Aggressive - Catches Falling Knife)
            // Enters immediately on the dip candle
            tradesA++;
            const pnlA = ((next.close - current.close) / current.close) * 100;
            if (pnlA > 0) winsA++;
            walletA += (walletA * 0.1) * (pnlA / 100);

            // -----------------------------------------------------
            // MEMORY TRAINING (Learn from every candle)
            // -----------------------------------------------------
            const patternKey = [
                candles[i - 2].close > candles[i - 2].open ? 'G' : 'R',
                candles[i - 1].close > candles[i - 1].open ? 'G' : 'R',
                current.close > current.open ? 'G' : 'R'
            ].join('');

            // Store result of NEXT candle (Future) for history
            const nextIsGreen = next.close > next.open;
            if (!memory[patternKey]) memory[patternKey] = { total: 0, green: 0 };
            memory[patternKey].total++;
            if (nextIsGreen) memory[patternKey].green++;

            // -----------------------------------------------------
            // TRADING DECISION (Test on Day 7 only)
            // -----------------------------------------------------
            // Only trade if we are in the "Test Window" (Last 24h)
            const isTestWindow = i > (candles.length - 288);

            if (isTestWindow) {
                // 1. STATISTICAL PROBABILITY
                const stats = memory[patternKey];
                const probability = stats ? (stats.green / stats.total) * 100 : 50;

                // 2. BLITZ SIGNAL (Dip)
                const drop = ((prev.close - current.close) / prev.close) * 100;
                const isDip = drop > 0.2;

                // HYBRID TRIGGER: Dip + Odds > 60%
                if (isDip && probability >= 60) {
                    tradesB++;
                    const pnlB = ((next.close - current.close) / current.close) * 100;
                    if (pnlB > 0) winsB++;
                    walletB += (walletB * 0.1) * (pnlB / 100);
                }
            }
        }
    }

    console.log('------------------------------------------------');
    console.log(`🧨 STRATEGY A (Aggressive): $${walletA.toFixed(2)}`);
    console.log(`   Trades: ${tradesA} | WinRate: ${((winsA / tradesA) * 100).toFixed(0)}%`);
    console.log('------------------------------------------------');
    console.log(`🛡️ STRATEGY B (HYBRID - Blitz + Stats): $${walletB.toFixed(2)}`);
    console.log(`   Trades: ${tradesB} | WinRate: ${((winsB / tradesB) * 100).toFixed(0)}%`);
    console.log('------------------------------------------------');

    if (walletB > walletA) console.log('✅ CONCLUSION: Green Filter SAVED money.');
    else console.log('❌ CONCLUSION: Aggressive was better (Rare).');
}

backtest();
