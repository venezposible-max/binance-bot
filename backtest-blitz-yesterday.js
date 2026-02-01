
import axios from 'axios';
import { analyzeOB } from './src/utils/analysis.js';

async function runBacktest() {
    // 1. Calculate Yesterday's Time Range
    const now = new Date();
    const yesterdayStart = new Date(now);
    yesterdayStart.setDate(now.getDate() - 1);
    yesterdayStart.setHours(0, 0, 0, 0);

    const yesterdayEnd = new Date(now);
    yesterdayEnd.setDate(now.getDate() - 1);
    yesterdayEnd.setHours(23, 59, 59, 999);

    console.log(`\n⏳ STARTING BLITZ BACKTEST (Yesterday)`);
    console.log(`   Range: ${yesterdayStart.toLocaleString()} - ${yesterdayEnd.toLocaleString()}`);
    console.log(`   Mode: BLITZ (1m Candles)`);
    console.log(`   Note: Testing PRICE IMPULSE only (Historical Flow not available)\n`);


    const symbols = ['BTCUSDT', 'SOLUSDT', 'ETHUSDT'];

    for (const symbol of symbols) {
        console.log(`\n🔄 ANALYZING ${symbol}...`);

        try {
            // 2. Fetch Historical 1m Candles
            const startTime = yesterdayStart.getTime();
            const endTime = yesterdayEnd.getTime();

            let allCandles = [];
            let currentStart = startTime;

            while (currentStart < endTime) {
                const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${currentStart}&endTime=${endTime}&limit=1000`;
                const { data } = await axios.get(url);
                if (data.length === 0) break;
                allCandles = [...allCandles, ...data];
                currentStart = data[data.length - 1][0] + 60000;
            }

            console.log(`   Loaded ${allCandles.length} candles.`);

            // 3. Simulation Loop
            let potentialTrades = [];
            const processedCandles = allCandles.map(c => ({
                open: parseFloat(c[1]),
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
                volume: parseFloat(c[5]),
                time: c[0]
            }));

            // We need at least 50 candles for indicators (EMA/ATR)
            for (let i = 50; i < processedCandles.length; i++) {
                const slice = processedCandles.slice(0, i + 1);
                const currentCandle = processedCandles[i];

                // Run Analysis with BLITZ config
                const result = analyzeOB(slice, { mode: 'BLITZ' });

                // Check specific Blitz Trigger (Impulse >= 0.5%)
                // We manually recalculate impulse here to be sure, or rely on analyzeOB's internal logic if it exposed it.
                // analyzeOB returns 'prediction' but doesn't explicitly expose 'impulse' value in return.
                // However, if analyzeOB returns a BUY signal, it means impulse condition was met.

                // BUT analyzeOB looks for OB zones formed in the PAST (last 3-4 candles).
                // Let's check if a NEW signal is generated at this exact candle.

                if (result.prediction.signal === 'BUY' || result.prediction.signal === 'BULLISH') {
                    // Check if we haven't already logged this zone
                    const lastLogged = potentialTrades.length > 0 ? potentialTrades[potentialTrades.length - 1] : null;
                    if (!lastLogged || (currentCandle.time - lastLogged.time > 15 * 60000)) { // Debounce 15 mins
                        potentialTrades.push({
                            symbol: symbol,
                            time: new Date(currentCandle.time).toLocaleTimeString(),
                            price: currentCandle.close,
                            signal: result.prediction.label,
                            tp: result.obZone ? result.obZone.tp.toFixed(2) : 'N/A'
                        });
                    }
                }
            }

            // 4. Report
            if (potentialTrades.length === 0) {
                console.log(`   ❌ No signals for ${symbol}`);
            } else {
                console.log(`   ✅ ${potentialTrades.length} SIGNALS for ${symbol}:`);
                console.table(potentialTrades);
            }

        } catch (e) {
            console.error('❌ Error in Backtest:', e.message);
        }
    }
    console.log('\n⚠️ Recordatorio: En vivo, estas señales se filtran adicionalmente por Order Flow (1.1x).');
}

runBacktest();
