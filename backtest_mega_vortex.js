
import axios from 'axios';
import { RSI, ATR } from 'technicalindicators';

// Seleccionamos las monedas más activas para un backtest real de 30 días en 5m
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'WIFUSDT'];
const INTERVAL = '5m';
const DAYS = 30;
const CANDLES_PER_REQUEST = 1000;
const TOTAL_CANDLES_NEEDED = 12 * 24 * DAYS; // 8640 velas aprox

async function fetchTrueMonthlyKlines(symbol) {
    let allKlines = [];
    let endTime = Date.now();

    console.log(`📡 Descargando datos 5m para ${symbol} (30 días)...`);

    // Necesitamos hacer unas 9 peticiones de 1000 velas para llegar a los 30 días en 5m
    for (let i = 0; i < 9; i++) {
        try {
            const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${INTERVAL}&limit=${CANDLES_PER_REQUEST}&endTime=${endTime}`;
            const res = await axios.get(url);
            if (!res.data || res.data.length === 0) break;
            allKlines = res.data.concat(allKlines);
            endTime = res.data[0][0] - 1;
            // Pequeña pausa para no saturar la API
            await new Promise(r => setTimeout(r, 100));
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
    const rawData = await fetchTrueMonthlyKlines(symbol);
    if (!rawData || rawData.length < 500) return null;

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
            // EXIT LOGIC: TP Dynamic or RSI2 > 85 (Profit taking exit)
            if (currentPrice >= activeTrade.tp || rsiPadded[i] > 85) {
                const pnl = (currentPrice - activeTrade.entry) / activeTrade.entry * 100;
                totalPnL += pnl;
                if (pnl > 0) wins++;
                activeTrade = null;
            } else if (i - activeTrade.index > 864) { // Time exit: 3 days max (864 velas de 5m)
                const pnl = (currentPrice - activeTrade.entry) / activeTrade.entry * 100;
                totalPnL += pnl;
                if (pnl > 0) wins++;
                activeTrade = null;
            }
            continue;
        }

        // VORTEX ENTRY: RSI(2) < 5 + HA Green
        if (rsiPadded[i] < 5 && ha[i].close > ha[i].open) {
            const currentATR = atrPadded[i];
            activeTrade = { entry: currentPrice, tp: currentPrice + (currentATR * 2.5), index: i };
            trades++;
        }
    }
    return { symbol, trades, wins, totalPnL };
}

async function runAll() {
    console.log(`--- BACKTESTING VORTEX: MES COMPLETO (30 DÍAS / 5M) ---`);
    let gt = 0, gw = 0, gp = 0;

    for (const s of SYMBOLS) {
        const r = await backtest(s);
        if (r && r.trades > 0) {
            console.log(`✅ ${r.symbol.padEnd(10)} | Trades: ${r.trades} | WR: ${(r.wins / r.trades * 100).toFixed(1)}% | PnL: +${r.totalPnL.toFixed(2)}%`);
            gt += r.trades; gw += r.wins; gp += r.totalPnL;
        }
    }

    console.log(`\n--- CONCLUSIÓN MENSUAL REAL ---`);
    console.log(`Total Trades: ${gt}`);
    console.log(`WinRate Global: ${((gw / gt) * 100).toFixed(1)}%`);
    console.log(`PROFIT NETO DEL MES (5 Monedas): +${gp.toFixed(2)}%`);
    console.log(`Estimación si usaras 15 monedas: +${(gp * 3).toFixed(2)}%`);
}

runAll();
