
import axios from 'axios';
import { analyzeOB } from './src/utils/analysis.js';

// --- HELPER: Top 10 Pairs ---
async function getDynamicTopPairs() {
    try {
        console.log('🔄 Fetching Top 10 Pairs by Volume...');
        let baseUrl = 'https://api.binance.com';
        let res;
        try {
            res = await axios.get(`${baseUrl}/api/v3/ticker/24hr`, { timeout: 5000 });
        } catch (e) {
            baseUrl = 'https://api.binance.us';
            res = await axios.get(`${baseUrl}/api/v3/ticker/24hr`, { timeout: 5000 });
        }

        const allPairs = res.data;
        const BLACKLIST = ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'AEUR', 'EUR', 'GBP', 'PAXG', 'WBTC'];

        const relevant = allPairs.filter(p => {
            if (!p.symbol.endsWith('USDT')) return false;
            if (BLACKLIST.some(blocked => p.symbol.includes(blocked))) return false;
            return parseFloat(p.quoteVolume) > 5000000;
        });

        relevant.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        return relevant.slice(0, 10).map(p => p.symbol);
    } catch (e) {
        console.warn('⚠️ Pairs Fetch Failed, using fallback.');
        return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT', 'ADAUSDT', 'TRXUSDT', 'AVAXUSDT', 'LINKUSDT'];
    }
}

// --- BACKTEST LOGIC ---
async function runBacktest() {
    const DAYS = 7;
    const now = new Date();
    const startTime = new Date(now);
    startTime.setDate(now.getDate() - DAYS);

    console.log(`\n⏳ STARTING WEEKLY BLITZ BACKTEST (Last ${DAYS} Days)`);
    console.log(`   Start: ${startTime.toLocaleString()}`);
    console.log(`   End:   ${now.toLocaleString()}`);
    console.log(`   Mode: BLITZ (Impulse > 0.5%)\n`);

    const symbols = await getDynamicTopPairs();
    console.log(`📋 Analyzing: ${symbols.join(', ')}\n`);

    console.log('Symbol       | Date       | Time     | Price       | Signal      | TP');
    console.log('----------------------------------------------------------------------------');

    let totalGlobalSignals = 0;

    for (const symbol of symbols) {
        // console.log(`   🔄 Loading data for ${symbol}...`); // Removed for cleaner output
        try {
            // Fetch 7 Days of 1m Candles (approx 10,000 candles)
            let allCandles = [];
            let currentStart = startTime.getTime();
            const endTime = now.getTime();

            while (currentStart < endTime) {
                // Try Global then US
                let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${currentStart}&limit=1000`;
                let data;
                try {
                    const res = await axios.get(url);
                    data = res.data;
                } catch (e) {
                    url = `https://api.binance.us/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${currentStart}&limit=1000`;
                    const res = await axios.get(url);
                    data = res.data;
                }

                if (!data || data.length === 0) break;

                // Stop if we went past the end time (API sometimes returns future if not careful)
                if (data[0][0] > endTime) break;

                allCandles = [...allCandles, ...data];
                currentStart = data[data.length - 1][0] + 60000;

                await new Promise(r => setTimeout(r, 50)); // Tiny Rate Limit sleep
            }

            // Process
            const processedCandles = allCandles.map(c => ({
                open: parseFloat(c[1]),
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
                volume: parseFloat(c[5]),
                time: c[0]
            }));

            let activePosition = null;
            let symbolPnL = 0;
            let symbolWins = 0;
            let symbolLosses = 0;

            for (let i = 50; i < processedCandles.length; i++) {
                const currentCandle = processedCandles[i];

                // 1. MANAGE ACTIVE POSITION
                if (activePosition) {
                    const { entry, tp, sl } = activePosition;
                    // Check Low for SL (Conservative: check SL first)
                    if (currentCandle.low <= sl) {
                        const lossPct = ((sl - entry) / entry) * 100;
                        symbolPnL += lossPct;
                        symbolLosses++;
                        activePosition = null;
                        // console.log(`      🛑 SL Hit: ${lossPct.toFixed(2)}%`);
                    } else if (currentCandle.high >= tp) {
                        const winPct = ((tp - entry) / entry) * 100;
                        symbolPnL += winPct;
                        symbolWins++;
                        activePosition = null;
                        // console.log(`      ✅ TP Hit: +${winPct.toFixed(2)}%`);
                    }
                    // Else: Hold
                    continue;
                }

                // 2. SEARCH FOR ENTRY
                const slice = processedCandles.slice(0, i + 1);
                const result = analyzeOB(slice, { mode: 'BLITZ' });

                if (result.prediction.signal === 'BUY' || result.prediction.signal === 'BULLISH') {
                    // Check if valid zones
                    if (result.obZone && result.obZone.tp && result.obZone.sl) {
                        activePosition = {
                            entry: currentCandle.close,
                            tp: result.obZone.tp,
                            sl: result.obZone.sl,
                            time: currentCandle.time
                        };

                        totalGlobalSignals++;

                        const dateStr = new Date(currentCandle.time).toLocaleDateString();
                        const timeStr = new Date(currentCandle.time).toLocaleTimeString();
                        // console.log(`${symbol.padEnd(8)} | ${dateStr} ${timeStr} | Entry: $${currentCandle.close} | TP: ${result.obZone.tp.toFixed(2)}`);
                    }
                }
            }

            // Report Symbol Results
            if (symbolWins + symbolLosses > 0) {
                const winRate = (symbolWins / (symbolWins + symbolLosses) * 100).toFixed(1);
                console.log(`${symbol.padEnd(12)} | ${symbolWins + symbolLosses} Trades | W: ${symbolWins} / L: ${symbolLosses} (${winRate}%) | Net PnL: ${symbolPnL.toFixed(2)}%`);
            } else {
                // console.log(`${symbol.padEnd(12)} | NO TRADES Executed`);
            }

        } catch (e) {
            console.error(`❌ Error scanning ${symbol}:`, e.message);
        }
    }

    console.log('----------------------------------------------------------------------------');
    console.log(`✅ COMPLETE. Total Potential Signals: ${totalGlobalSignals}`);
}

runBacktest();
