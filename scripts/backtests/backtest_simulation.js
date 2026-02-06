
import axios from 'axios';
import { EMA, RSI, ATR } from 'technicalindicators';

// --- CONFIG ---
const CAPITAL = 500;
const RISK_PER_TRADE = 0.10; // 10%
const MAX_TRADES = 3;
const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const TIMEFRAME = '5m';
const DAYS = 30;

// --- STATE ---
let wallet = {
    balance: CAPITAL,
    history: [],
    drawdown: 0,
    peak: CAPITAL
};
let activeTrades = [];

// --- MOCKED ANALYSIS (Adapted from src/utils/analysis.js) ---
function analyzeCandle(candles) {
    // Needs at least 30 candles
    if (candles.length < 50) return null;

    const closes = candles.map(c => parseFloat(c[4]));
    const highs = candles.map(c => parseFloat(c[2]));
    const lows = candles.map(c => parseFloat(c[3]));
    const lastPrice = closes[closes.length - 1];

    // Indicators
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const currentATR = atrValues[atrValues.length - 1] || (lastPrice * 0.01);

    // Order Block Scan (Simplified for Backtest - No Flow)
    // We assume High Volume + Impulse = Entry
    const candle = candles[candles.length - 1]; // Current (Completed)

    // Scan last few candles
    for (let i = candles.length - 2; i > candles.length - 10; i--) {
        const c = candles[i];
        const p = candles[i - 1];
        const close = parseFloat(c[4]);
        const prevOp = parseFloat(p[1]);
        const prevCl = parseFloat(p[4]);

        const impulse = ((close - prevOp) / prevOp) * 100;
        const wasBearish = prevCl < prevOp;

        // DEBUG SAMPLE
        if (Math.random() < 0.0001) {
            console.log(`[TRACE] Imp:${impulse.toFixed(2)} Bear:${wasBearish} ATR:${currentATR.toFixed(2)}`);
        }

        if (impulse >= 0.05 && wasBearish) { // RELAXED THRESHOLD (0.05%)
            // console.log(`[SIGNAL] Found at ${new Date(candle[0]).toISOString()} Imp:${impulse.toFixed(2)}`);
            // Found Potential Signal
            // TARGET CALCULATION (The new logic)
            let rawTarget = lastPrice + (currentATR * 2.5);
            // THE 0.45% FLOOR
            let targetPrice = Math.max(rawTarget, lastPrice * 1.0045);

            // Return Signal
            return {
                symbol: 'UNKNOWN', // Set by caller
                entryPrice: lastPrice,
                tp: targetPrice,
                stopLoss: null, // Strategy has no SL
                timestamp: candle[0] // Open time
            };
        }
    }
    return null;
}

// --- DATA FETCHER ---
async function fetchHistory(symbol) {
    let allCandles = [];
    let endTime = Date.now();
    const limit = 1000; // Max per req

    console.log(`📥 Fetching data for ${symbol}...`);

    for (let i = 0; i < 10; i++) {
        try {
            const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${TIMEFRAME}&limit=${limit}&endTime=${endTime}`;
            const res = await axios.get(url);
            const data = res.data;
            if (!data || data.length === 0) break;

            allCandles = [...data, ...allCandles]; // Prepend (we go backwards in time)
            endTime = data[0][0] - 1; // Move cursor

            if (allCandles.length > (12 * 24 * DAYS)) break;
            await new Promise(r => setTimeout(r, 100)); // Rate limit niceness
        } catch (e) {
            console.error(`Fetch error: ${e.message}`);
            break;
        }
    }

    // Sort chronological
    allCandles.sort((a, b) => a[0] - b[0]);
    return allCandles;
}

// --- ENGINE ---
async function runBacktest() {
    const marketData = {};

    // 1. Load Data
    for (const pair of PAIRS) {
        marketData[pair] = await fetchHistory(pair);
    }

    // 2. Align Data (Time Loop)
    // Find latest common start time
    let startTime = 0;
    for (const p of PAIRS) {
        if (marketData[p].length > 0) {
            const first = marketData[p][0][0];
            if (first > startTime) startTime = first;
        }
    }

    console.log(`\n🕹️ STARTING SIMULATION [${new Date(startTime).toISOString()}]`);
    console.log(`💰 Capital: $${CAPITAL} | Floor: 0.45% | Max Trades: ${MAX_TRADES}`);

    // Debug Data Quality
    for (const p of PAIRS) {
        console.log(`[DEBUG] ${p}: ${marketData[p].length} candles.`);
    }

    // Find index for each pair at startTime
    const cursors = {};
    for (const p of PAIRS) cursors[p] = marketData[p].findIndex(c => c[0] >= startTime);

    // Loop step (5m)
    // Limit to safety (avoid infinite)
    let maxSteps = 10000;

    while (maxSteps-- > 0) {
        // A. Check Pairs
        for (const pair of PAIRS) {
            const idx = cursors[pair];
            const candles = marketData[pair];

            if (idx >= candles.length || idx < 50) continue;

            const currentCandle = candles[idx];
            // Candle format: [Time, Open, High, Low, Close, Vol, ...]
            const currentTime = currentCandle[0];
            const currentHigh = parseFloat(currentCandle[2]);
            const currentLow = parseFloat(currentCandle[3]);
            const currentClose = parseFloat(currentCandle[4]);

            // 1. MANAGE ACTIVE TRADES
            for (let i = activeTrades.length - 1; i >= 0; i--) {
                const trade = activeTrades[i];
                if (trade.symbol === pair) {
                    // Update Duration
                    trade.durationCandles++;

                    // Check EXIT (TP only)
                    if (currentHigh >= trade.tp) {
                        // WIN
                        // Calculate Fees (0.1% entry + 0.1% exit = 0.2%)
                        const grossPnl = ((trade.tp - trade.entryPrice) / trade.entryPrice); // e.g. 0.0045
                        const fee = 0.002; // 0.2%
                        const netPnl = grossPnl - fee;
                        const profit = (trade.invested * netPnl);

                        wallet.balance += (trade.invested + profit);
                        wallet.history.push({
                            res: 'WIN',
                            pnl: (netPnl * 100).toFixed(2),
                            profit: profit.toFixed(2),
                            days: (trade.durationCandles * 5 / 60 / 24).toFixed(2),
                            symbol: pair
                        });

                        activeTrades.splice(i, 1);
                        continue;
                    }

                    // LIQUIDATION CHECK (Safety)
                    // If drops 50%? Unlikely in spot. But let's say -50%
                    if (currentLow < trade.entryPrice * 0.5) {
                        // Rekt
                        wallet.history.push({ res: 'LIQ', pnl: -100, profit: -trade.invested, symbol: pair });
                        activeTrades.splice(i, 1);
                    }
                }
            }

            // 2. SCAN FOR ENTRY
            if (activeTrades.length < MAX_TRADES) {
                // Look at PAST candles (up to idx)
                // const analysisSlice = candles.slice(idx - 50, idx + 1);

                const signalPrice = parseFloat(candles[idx][1]); // Open price of current

                // IMPORTANT: Pass slice ending BEFORE current candle?
                // analyzeCandle creates indicators on past data.
                // We should pass data up to idx.
                const pastSlice = candles.slice(idx - 60, idx); // Enough history

                const signal = analyzeCandle(pastSlice);

                if (signal) {
                    // Check duplicate
                    if (!activeTrades.find(t => t.symbol === pair)) {
                        // ENTER
                        const invest = wallet.balance * RISK_PER_TRADE;
                        if (invest > 10) {
                            wallet.balance -= invest;
                            activeTrades.push({
                                symbol: pair,
                                entryPrice: signalPrice, // Open of current
                                tp: signal.tp,
                                invested: invest,
                                durationCandles: 0,
                                startTime: currentTime
                            });
                        }
                    }
                }
            }

            // Move cursor
            cursors[pair]++;
        }

        // Stats
        if (wallet.balance > wallet.peak) wallet.peak = wallet.balance;
        const currentEquity = wallet.balance + activeTrades.reduce((acc, t) => acc + t.invested, 0); // approx
        const dd = ((wallet.peak - currentEquity) / wallet.peak) * 100;
        if (dd > wallet.drawdown) wallet.drawdown = dd;

        // Break if all done
        let allDone = true;
        for (const p of PAIRS) {
            if (cursors[p] < marketData[p].length - 1) allDone = false;
        }
        if (allDone) break;
    }

    // CLOSE ALL OPEN AT END
    for (const trade of activeTrades) {
        // Mark as floating
        // Just assume break even for calc
        wallet.balance += trade.invested;
    }

    console.log('\n📊 RESULTS:');
    console.log(`Ends Balance: $${wallet.balance.toFixed(2)} (${((wallet.balance - CAPITAL) / CAPITAL * 100).toFixed(1)}%)`);
    console.log(`Max Drawdown: ${wallet.drawdown.toFixed(2)}%`);
    console.log(`Total Trades: ${wallet.history.length}`);
    const wins = wallet.history.filter(h => h.res === 'WIN').length;
    console.log(`Win Rate: ${((wins / wallet.history.length) * 100).toFixed(1)}%`);

    // Duration
    const avgDur = wallet.history.reduce((acc, h) => acc + parseFloat(h.days), 0) / wallet.history.length;
    console.log(`Avg Duration: ${(avgDur * 24).toFixed(1)} Hours`);

    // Bag Holders?
    if (activeTrades.length > 0) {
        console.log(`⚠️ Note: ${activeTrades.length} trades were still open at the end.`);
    }
}

runBacktest();
