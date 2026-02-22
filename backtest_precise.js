
import axios from 'axios';
import { RSI, ATR } from 'technicalindicators';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'WIFUSDT', 'SUIUSDT', 'FETUSDT', 'AVAXUSDT'];
const INTERVAL = '5m';
const DAYS = 30;
const CANDLES_PER_REQUEST = 1000;

async function fetchHeavyKlines(symbol) {
    let allKlines = [];
    let endTime = Date.now();

    // We need around 8640 candles (30 days * 24h * 12 candles/h)
    // We do 10 requests of 1000 to be safe
    for (let i = 0; i < 10; i++) {
        try {
            const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${INTERVAL}&limit=${CANDLES_PER_REQUEST}&endTime=${endTime}`;
            const res = await axios.get(url);
            if (!res.data || res.data.length === 0) break;
            allKlines = res.data.concat(allKlines);
            endTime = res.data[0][0] - 1;
        } catch (e) { break; }
    }
    return allKlines;
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
    const rawData = await fetchHeavyKlines(symbol);
    if (!rawData || rawData.length < 100) return null;

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
            if (currentPrice >= activeTrade.tp || rsiPadded[i] > 80) {
                const pnl = (currentPrice - activeTrade.entry) / activeTrade.entry * 100;
                totalPnL += pnl;
                if (pnl > 0) wins++;
                activeTrade = null;
            } else if (i - activeTrade.index > 576) { // 2 days max
                const pnl = (currentPrice - activeTrade.entry) / activeTrade.entry * 100;
                totalPnL += pnl;
                if (pnl > 0) wins++;
                activeTrade = null;
            }
            continue;
        }

        // UNIXA condition: RSI(2) < 2.0
        const isExhausted = rsiPadded[i] < 2.0;
        const isHAConfirmation = ha[i].close > ha[i].open;

        if (isExhausted && isHAConfirmation) {
            const currentATR = atrPadded[i];
            activeTrade = { entry: currentPrice, tp: currentPrice + (currentATR * 2), index: i };
            trades++;
        }
    }
    return { symbol, trades, wins, totalPnL };
}

async function runAll() {
    console.log(`--- BACKTESTING VORTEX / UNIXA PURA: ÚLTIMAS ${DAYS} DÍAS (5M - REAL) ---`);
    let gt = 0, gw = 0, gp = 0;
    for (const s of SYMBOLS) {
        const r = await backtest(s);
        if (r && r.trades > 0) {
            console.log(`${r.symbol.padEnd(10)}: T:${String(r.trades).padEnd(2)} | WR:${(r.wins / r.trades * 100).toFixed(0)}% | PnL:+${r.totalPnL.toFixed(2)}%`);
            gt += r.trades; gw += r.wins; gp += r.totalPnL;
        }
    }
    console.log(`\n--- CONCLUSIÓN MENSUAL (Sin Stop Loss Duro, cierre RSI o Tiempo) ---`);
    console.log(`Total Trades: ${gt}`);
    console.log(`WinRate Global: ${((gw / gt) * 100).toFixed(1)}%`);
    console.log(`Rentabilidad Mensual Bruta: +${gp.toFixed(2)}%`);
}
runAll();
