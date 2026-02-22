
import axios from 'axios';
import { RSI, ATR } from 'technicalindicators';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'BNBUSDT', 'AVAXUSDT', 'LINKUSDT', 'SHIBUSDT', 'FETUSDT', 'NEARUSDT', 'WIFUSDT', 'SUIUSDT'];
const INTERVAL = '5m';
const DAYS = 1;
const LIMIT = 12 * 24 * DAYS; // 288 candles for the last 24 hours

async function fetchKlines(symbol) {
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${INTERVAL}&limit=${LIMIT}`;
        const res = await axios.get(url);
        return res.data;
    } catch (e) { return null; }
}

function calculateHeikinAshi(klines) {
    const haCandles = [];
    for (let i = 0; i < klines.length; i++) {
        const o = parseFloat(klines[i][1]);
        const h = parseFloat(klines[i][2]);
        const l = parseFloat(klines[i][3]);
        const c = parseFloat(klines[i][4]);
        const haClose = (o + h + l + c) / 4;
        let haOpen = i === 0 ? (o + c) / 2 : (haCandles[i - 1].open + haCandles[i - 1].close) / 2;
        const haHigh = Math.max(h, haOpen, haClose);
        const haLow = Math.min(l, haOpen, haClose);
        haCandles.push({ open: haOpen, close: haClose, high: haHigh, low: haLow });
    }
    return haCandles;
}

async function backtest(symbol) {
    const rawData = await fetchKlines(symbol);
    if (!rawData || rawData.length < 50) return null;

    const closes = rawData.map(d => parseFloat(d[4]));
    const highs = rawData.map(d => parseFloat(d[2]));
    const lows = rawData.map(d => parseFloat(d[3]));

    const rsi2 = RSI.calculate({ values: closes, period: 2 });
    const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const ha = calculateHeikinAshi(rawData);

    const rsiPadded = new Array(closes.length - rsi2.length).fill(50).concat(rsi2);
    const atrPadded = new Array(closes.length - atr.length).fill(0).concat(atr);

    let trades = 0, wins = 0, totalPnL = 0, activeTrade = null;

    for (let i = 20; i < rawData.length; i++) {
        const currentPrice = closes[i];

        if (activeTrade) {
            // VORTEX EXIT: ATR Target or RSI(2) > 80
            if (currentPrice >= activeTrade.tp || rsiPadded[i] > 80) {
                const pnl = (currentPrice - activeTrade.entry) / activeTrade.entry * 100;
                totalPnL += pnl;
                if (pnl > 0) wins++;
                activeTrade = null;
            } else if (i - activeTrade.index > 48) { // 4 hours max for a day-trade logic
                const pnl = (currentPrice - activeTrade.entry) / activeTrade.entry * 100;
                totalPnL += pnl;
                if (pnl > 0) wins++;
                activeTrade = null;
            }
            continue;
        }

        // VORTEX ENTRY: RSI(2) < 10 + HA Green
        const isExhausted = rsiPadded[i] < 10;
        const isHAConfirmation = ha[i].close > ha[i].open;

        if (isExhausted && isHAConfirmation) {
            const currentATR = atrPadded[i];
            activeTrade = {
                entry: currentPrice,
                tp: currentPrice + (currentATR * 1.5),
                index: i
            };
            trades++;
        }
    }
    return { symbol, trades, wins, totalPnL };
}

async function runAll() {
    console.log(`--- BACKTESTING VORTEX: ÚLTIMAS 24 HORAS (5M) ---`);
    let gt = 0, gw = 0, gp = 0;
    const items = [];
    for (const s of SYMBOLS) {
        const r = await backtest(s);
        if (r && r.trades > 0) {
            items.push(r);
            gt += r.trades; gw += r.wins; gp += r.totalPnL;
        }
    }
    items.sort((a, b) => b.totalPnL - a.totalPnL);
    items.forEach(r => {
        console.log(`${r.symbol.padEnd(10)}: T:${String(r.trades).padEnd(2)} | WR:${(r.wins / r.trades * 100).toFixed(0)}% | PnL:+${r.totalPnL.toFixed(2)}%`);
    });

    console.log(`\n--- CONCLUSIÓN DIARIA ---`);
    if (gt === 0) {
        console.log("No se detectaron 'Vórtices' perfectos en las últimas 24h.");
    } else {
        console.log(`Total Trades: ${gt} | WinRate: ${((gw / gt) * 100).toFixed(1)}% | Profit Hoy: +${gp.toFixed(2)}%`);
    }
}
runAll();
