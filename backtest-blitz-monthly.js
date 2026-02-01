
import axios from 'axios';
import { analyzeOB } from './src/utils/analysis.js';

// --- HELPER: Top 10 Pairs
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
        const BLACKLIST = ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'AEUR', 'EUR', 'GBP', 'PAXG', 'WBTC', 'USDE'];

        const relevant = allPairs.filter(p => {
            if (!p.symbol.endsWith('USDT')) return false;
            if (BLACKLIST.some(blocked => p.symbol.includes(blocked))) return false;
            return parseFloat(p.quoteVolume) > 5000000;
        });

        relevant.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        return relevant.slice(0, 10).map(p => p.symbol);
    } catch (e) {
        return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT', 'ADAUSDT', 'TRXUSDT', 'AVAXUSDT', 'LINKUSDT'];
    }
}

// --- BACKTEST LOGIC ---
async function runBacktest() {
    const DAYS = 30;
    const now = new Date();
    const startTime = new Date(now);
    startTime.setDate(now.getDate() - DAYS);

    console.log(`\n⏳ STARTING MONTHLY BLITZ BACKTEST (Last ${DAYS} Days)`);
    console.log('   Please wait, fetching extensive data (this may take 1-2 mins)...');

    const symbols = await getDynamicTopPairs();
    console.log(`📋 Analyzing: ${symbols.join(', ')}\n`);

    let globalWins = 0;
    let globalLosses = 0;
    let globalPnL = 0;
    let totalTrades = 0;

    console.log('Symbol       | Trades | Win Rate | Net PnL');
    console.log('-------------------------------------------');

    for (const symbol of symbols) {
        try {
            let allCandles = [];
            let currentStart = startTime.getTime();
            const endTime = now.getTime();

            // Fetch Loop
            while (currentStart < endTime) {
                let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${currentStart}&limit=1000`;
                let data;
                try {
                    const res = await axios.get(url);
                    data = res.data;
                } catch (e) {
                    // Retry once with US
                    url = `https://api.binance.us/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${currentStart}&limit=1000`;
                    try {
                        const res = await axios.get(url);
                        data = res.data;
                    } catch (err) { break; }
                }

                if (!data || data.length === 0) break;
                if (data[0][0] > endTime) break;

                allCandles = [...allCandles, ...data];
                currentStart = data[data.length - 1][0] + 60000;

                await new Promise(r => setTimeout(r, 20)); // Small delay
            }

            // Process
            const processedCandles = allCandles.map(c => ({
                open: parseFloat(c[1]),
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
                time: c[0]
            }));

            let activePosition = null;
            let symbolPnL = 0;
            let symbolWins = 0;
            let symbolLosses = 0;

            for (let i = 50; i < processedCandles.length; i++) {
                const currentCandle = processedCandles[i];

                if (activePosition) {
                    const { entry, tp, sl } = activePosition;
                    if (currentCandle.low <= sl) {
                        const lossPct = ((sl - entry) / entry) * 100;
                        symbolPnL += lossPct;
                        symbolLosses++;
                        activePosition = null;
                    } else if (currentCandle.high >= tp) {
                        const winPct = ((tp - entry) / entry) * 100;
                        symbolPnL += winPct;
                        symbolWins++;
                        activePosition = null;
                    }
                    continue;
                }

                const slice = processedCandles.slice(0, i + 1);
                const result = analyzeOB(slice, { mode: 'BLITZ' });

                if (result.prediction.signal === 'BUY' || result.prediction.signal === 'BULLISH') {
                    if (result.obZone && result.obZone.tp && result.obZone.sl) {
                        activePosition = {
                            entry: currentCandle.close,
                            tp: result.obZone.tp,
                            sl: result.obZone.sl
                        };
                    }
                }
            }

            const total = symbolWins + symbolLosses;
            if (total > 0) {
                const wr = (symbolWins / total * 100).toFixed(0);
                const pnlColor = symbolPnL >= 0 ? '+' : '';
                console.log(`${symbol.padEnd(12)} | ${total.toString().padEnd(6)} | ${wr}%      | ${pnlColor}${symbolPnL.toFixed(2)}%`);

                globalWins += symbolWins;
                globalLosses += symbolLosses;
                globalPnL += symbolPnL;
                totalTrades += total;
            } else {
                console.log(`${symbol.padEnd(12)} | 0      | 0%       | 0.00%`);
            }

        } catch (e) {
            console.error(`❌ Error scanning ${symbol}:`, e.message);
        }
    }

    console.log('-------------------------------------------');
    console.log(`\n🏆 RESUMEN FINAL (30 DÍAS)`);
    console.log(`   Trades Totales: ${totalTrades}`);
    console.log(`   Ganados:        ${globalWins}`);
    console.log(`   Perdidos:       ${globalLosses}`);
    console.log(`   Win Rate:       ${totalTrades > 0 ? (globalWins / totalTrades * 100).toFixed(1) : 0}%`);
    console.log(`\n💰 PROFIT NETO ACUMULADO: ${globalPnL >= 0 ? '✅' : '❌'} ${globalPnL > 0 ? '+' : ''}${globalPnL.toFixed(2)}%`);
}

runBacktest();
