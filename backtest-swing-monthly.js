import axios from 'axios';
import { analyzeHybrid } from './src/utils/analysis.js';

// --- CONFIG ---
const DAYS = 30;
const TIMEFRAME = '1h'; // Swing uses 1h
const CANDLES_NEEDED = DAYS * 24; // ~720
const INITIAL_BALANCE = 1000;
const TRADE_AMOUNT = 100; // Fixed size for simplicity

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
        const BLACKLIST = ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'AEUR', 'EUR', 'GBP', 'PAXG', 'WBTC', 'USDE'];

        const relevant = allPairs.filter(p => {
            if (!p.symbol.endsWith('USDT')) return false;
            if (BLACKLIST.some(blocked => p.symbol.includes(blocked))) return false;
            return parseFloat(p.quoteVolume) > 10000000;
        });

        relevant.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        return relevant.slice(0, 10).map(p => p.symbol);
    } catch (e) {
        return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'AVAXUSDT', 'LINKUSDT'];
    }
}

// --- BACKTEST LOGIC ---
async function runBacktest() {
    console.log(`\n⏳ STARTING MONTHLY SWING BACKTEST (Last ${DAYS} Days)`);
    console.log('   Strategy: HYBRID_SWING (Impulse > 2.0%)');
    console.log(`   Timeframe: ${TIMEFRAME}`);

    const symbols = await getDynamicTopPairs();
    console.log(`📋 Analyzing: ${symbols.join(', ')}\n`);

    console.log('Symbol       | Trades | Win Rate | Net PnL');
    console.log('-------------------------------------------');

    let totalTrades = 0;
    let totalWins = 0;
    let globalPnl = 0;

    for (const symbol of symbols) {
        try {
            // Fetch 1h candles (Limit 1000 covers >40 days, so one call is enough)
            const klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${TIMEFRAME}&limit=${CANDLES_NEEDED + 50}`; // +50 for warmup
            const { data: klines } = await axios.get(klinesUrl);

            const candles = klines.map(c => ({
                open: parseFloat(c[1]),
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
                volume: parseFloat(c[5])
            }));

            // Simulation State
            let activeTrade = null;
            let wins = 0;
            let losses = 0;
            let pnl = 0;

            // Iterate through history
            // Start after warmup (50 candles)
            for (let i = 50; i < candles.length; i++) {
                const currentCandle = candles[i];
                const currentPrice = currentCandle.close;

                // 1. Manage Active Trade
                if (activeTrade) {
                    // Check against High/Low of THIS candle (approximate execution)
                    // In real backtest we might check minute data inside the hour, but for Swing 1h is okay-ish granularity

                    // Hit TP?
                    if (currentCandle.high >= activeTrade.tp) {
                        const profit = (activeTrade.tp - activeTrade.entry) / activeTrade.entry;
                        pnl += profit * 100;
                        wins++;
                        activeTrade = null;
                        continue;
                    }

                    // Hit SL?
                    if (currentCandle.low <= activeTrade.sl) {
                        const loss = (activeTrade.sl - activeTrade.entry) / activeTrade.entry;
                        pnl += loss * 100; // Negative
                        losses++;
                        activeTrade = null;
                        continue;
                    }
                }

                // 2. Look for Entry (if no trade)
                if (!activeTrade) {
                    // Slice history up to i
                    const pastCandles = candles.slice(0, i + 1);

                    // Use analyzeOB directly because we don't have historical Order Book (Depth)
                    // The core of Swing is the OB Impulse + Trend filter.
                    const { analyzeOB } = await import('./src/utils/analysis.js');
                    const analysis = await analyzeOB(pastCandles, { mode: 'SWING' });

                    if (analysis.prediction.signal === 'BUY' || analysis.prediction.signal === 'BULLISH' || analysis.prediction.signal === 'STRONG_BUY') {
                        // Entry
                        let tp = analysis.obZone ? analysis.obZone.tp : currentPrice * 1.05;
                        let sl = analysis.obZone ? analysis.obZone.sl : currentPrice * 0.95;

                        // Fallback logic if obZone missing but signal fired
                        if (!analysis.obZone) {
                            tp = currentPrice * 1.05;
                            sl = currentPrice * 0.95;
                        }

                        activeTrade = {
                            entry: currentPrice,
                            tp: tp,
                            sl: sl
                        };
                    }
                }
            }

            const trades = wins + losses;
            const winRate = trades > 0 ? Math.round((wins / trades) * 100) : 0;
            const color = pnl >= 0 ? '\x1b[32m' : '\x1b[31m'; // Green/Red
            const reset = '\x1b[0m';

            console.log(`${symbol.padEnd(12)} | ${trades.toString().padEnd(6)} | ${winRate}%      | ${color}${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%${reset}`);

            totalTrades += trades;
            totalWins += wins;
            globalPnl += pnl;

        } catch (e) {
            console.log(`${symbol.padEnd(12)} | ERROR: ${e.message}`);
        }
    }

    console.log('\n-------------------------------------------');
    console.log(`TOTAL PnL (Simple Sum): ${globalPnl >= 0 ? '+' : ''}${globalPnl.toFixed(2)}%`);
    console.log(`TOTAL TRADES: ${totalTrades}`);
}

runBacktest();
