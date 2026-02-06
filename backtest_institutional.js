
import axios from 'axios';
import { EMA, RSI, ATR } from 'technicalindicators';

// --- CONFIG ---
const CAPITAL = 10000; // Institutional Size
const MAX_TRADES = 5;
const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const TIMEFRAME = '4h'; // MAJOR LEAGUE
const DAYS = 60; // 2 Months

// RISK MANAGEMENT
const FIXED_RISK_PER_TRADE = 0.01; // 1% Risk of Equity per trade
const HARD_STOP_LOSS = 0.01; // 1% Distance (Strict)

// --- STATE ---
let wallet = {
    balance: CAPITAL,
    history: [],
    drawdown: 0,
    peak: CAPITAL
};
let activeTrades = [];

// --- INSTITUTIONAL STRATEGY (EMA Trends) ---
function analyzeCandle(candles) {
    if (candles.length < 50) return null;

    const closes = candles.map(c => parseFloat(c[4]));

    // EMA CROSS (9 / 21)
    const ema9 = EMA.calculate({ period: 9, values: closes });
    const ema21 = EMA.calculate({ period: 21, values: closes });

    // Get last values
    const currentPrice = closes[closes.length - 1];
    const prevPrice = closes[closes.length - 2];

    const curr9 = ema9[ema9.length - 1];
    const curr21 = ema21[ema21.length - 1];
    const prev9 = ema9[ema9.length - 2];
    const prev21 = ema21[ema21.length - 2];

    // DEBUG
    if (Math.random() < 0.1) console.log(`[DEBUG] EMA9: ${curr9?.toFixed(2)} EMA21: ${curr21?.toFixed(2)} P9:${prev9?.toFixed(2)} P21:${prev21?.toFixed(2)}`);

    // LONG SIGNAL: 9 Crosses ABOVE 21
    if (prev9 <= prev21 && curr9 > curr21) {
        console.log(`[SIGNAL LONG] ${currentPrice}`);
        return { type: 'LONG', price: currentPrice };
    }

    // SHORT SIGNAL: 9 Crosses BELOW 21
    if (prev9 >= prev21 && curr9 < curr21) {
        console.log(`[SIGNAL SHORT] ${currentPrice}`);
        return { type: 'SHORT', price: currentPrice };
    }

    return null;
}

// --- DATA FETCHER ---
async function fetchHistory(symbol) {
    let allCandles = [];
    let endTime = Date.now();
    const limit = 1000;

    console.log(`📥 Fetching data for ${symbol}...`);

    for (let i = 0; i < 5; i++) { // 4h candles cover more time
        try {
            const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${TIMEFRAME}&limit=${limit}&endTime=${endTime}`;
            const res = await axios.get(url);
            const data = res.data;
            if (!data || data.length === 0) break;

            allCandles = [...data, ...allCandles];
            endTime = data[0][0] - 1;

            if (allCandles.length > (6 * DAYS)) break; // 6 candles per day * 60 days = 360
            await new Promise(r => setTimeout(r, 100));
        } catch (e) {
            break;
        }
    }

    allCandles.sort((a, b) => a[0] - b[0]);
    return allCandles;
}

// --- ENGINE ---
async function runBacktest() {
    const marketData = {};
    for (const pair of PAIRS) marketData[pair] = await fetchHistory(pair);

    let startTime = 0;
    for (const p of PAIRS) {
        if (marketData[p].length > 0) {
            const first = marketData[p][0][0];
            if (first > startTime) startTime = first;
        }
    }

    console.log(`\n🏦 INSTITUTIONAL SIMULATION [${new Date(startTime).toISOString()}]`);
    console.log(`💰 AUM: $${CAPITAL.toLocaleString()} | Risk: 1% | Stop: 1% Hard`);

    const cursors = {};
    for (const p of PAIRS) cursors[p] = marketData[p].findIndex(c => c[0] >= startTime);

    let maxSteps = 10000;

    while (maxSteps-- > 0) {
        for (const pair of PAIRS) {
            const idx = cursors[pair];
            const candles = marketData[pair];

            if (idx >= candles.length || idx < 50) continue;

            const currentCandle = candles[idx];
            const currentHigh = parseFloat(currentCandle[2]);
            const currentLow = parseFloat(currentCandle[3]);

            // 1. MANAGE POSITIONS
            for (let i = activeTrades.length - 1; i >= 0; i--) {
                const trade = activeTrades[i];
                if (trade.symbol === pair) {
                    let pnlPercent = 0;
                    let closed = false;

                    if (trade.side === 'LONG') {
                        // STOP LOSS HIT?
                        if (currentLow <= trade.sl) {
                            pnlPercent = -0.01; // -1% fixed
                            closed = true;
                        }
                        // TAKE PROFIT (Trailing or Target) -> Let's say 2% Target
                        else if (currentHigh >= trade.tp) {
                            pnlPercent = 0.03; // 3% Target (3R)
                            closed = true;
                        }
                    } else { // SHORT
                        // STOP LOSS HIT? (High > SL)
                        if (currentHigh >= trade.sl) {
                            pnlPercent = -0.01;
                            closed = true;
                        }
                        // TAKE PROFIT (Low < TP)
                        else if (currentLow <= trade.tp) {
                            pnlPercent = 0.03;
                            closed = true;
                        }
                    }

                    if (closed) {
                        const dollarPnl = trade.positionSize * pnlPercent;
                        const fee = trade.positionSize * 0.002; // 0.2% fee
                        const net = dollarPnl - fee;

                        wallet.balance += net;
                        wallet.history.push({
                            res: net > 0 ? 'WIN' : 'LOSS',
                            pnl: dollarPnl.toFixed(2),
                            net: net.toFixed(2),
                            side: trade.side
                        });
                        activeTrades.splice(i, 1);
                    }
                }
            }

            // 2. ENTRY Logic
            if (activeTrades.length < MAX_TRADES) {
                const pastSlice = candles.slice(idx - 50, idx);
                const signal = analyzeCandle(pastSlice);
                const price = parseFloat(candles[idx][1]); // Open

                if (signal) {
                    if (!activeTrades.find(t => t.symbol === pair)) {
                        // POSITION SIZING
                        // Risk Amount = Equity * 0.01 (1%) => $100
                        // Stop Distance = 1%
                        // Size = Risk / Distance = $100 / 0.01 = $10,000 (1x Leverage)
                        // If Stop was 2%, Size = $5,000.

                        // We use 1% SL, so Size = Balance. (Full Port? No, allocated).
                        // Let's stick to Safe Alloc: Max 20% of Portfolio per trade.
                        const positionSize = wallet.balance * 0.20;

                        let slPrice, tpPrice;
                        if (signal.type === 'LONG') {
                            slPrice = price * 0.99; // -1%
                            tpPrice = price * 1.03; // +3%
                        } else {
                            slPrice = price * 1.01; // +1%
                            tpPrice = price * 0.97; // -3%
                        }

                        activeTrades.push({
                            symbol: pair,
                            side: signal.type,
                            entry: price,
                            sl: slPrice,
                            tp: tpPrice,
                            positionSize: positionSize
                        });
                    }
                }
            }
            cursors[pair]++;
        }

        let allDone = true;
        for (const p of PAIRS) if (cursors[p] < marketData[p].length - 1) allDone = false;
        if (allDone) break;
    }

    console.log('\n📊 INSTITUTIONAL RESULTS:');
    console.log(`Ends Balance: $${wallet.balance.toFixed(2)} (${((wallet.balance - CAPITAL) / CAPITAL * 100).toFixed(1)}%)`);
    console.log(`Trades: ${wallet.history.length}`);
    const wins = wallet.history.filter(h => h.res === 'WIN').length;
    console.log(`Win Rate: ${((wins / wallet.history.length) * 100).toFixed(1)}%`);
}

runBacktest();
