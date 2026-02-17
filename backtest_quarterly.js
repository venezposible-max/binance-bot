
import axios from 'axios';
import { RSI, ATR } from 'technicalindicators';

// Seleccionamos las monedas con más histórico y volumen para evaluar 90 días
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'WIFUSDT', 'PEPEUSDT', 'BONKUSDT', 'FETUSDT', 'LINKUSDT', 'TRXUSDT'];
const INTERVAL = '15m'; // Subimos de 5m a 15m solo por volumen de datos/API, pero con lógica Vortex ajustada
const DAYS = 90;
const CANDLES_PER_REQUEST = 1000;
const TOTAL_CANDLES_NEEDED = 4 * 24 * DAYS; // ~8640 velas de 15m

async function fetchHeavyKlines(symbol) {
    let allKlines = [];
    let endTime = Date.now();
    console.log(`📡 Descargando 90 días para ${symbol}...`);

    // Necesitamos unas 9 peticiones de 1000 velas para llegar a los 90 días en 15m
    for (let i = 0; i < 9; i++) {
        try {
            const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${INTERVAL}&limit=${CANDLES_PER_REQUEST}&endTime=${endTime}`;
            const res = await axios.get(url);
            if (!res.data || res.data.length === 0) break;
            allKlines = res.data.concat(allKlines);
            endTime = res.data[0][0] - 1;
            await new Promise(r => setTimeout(r, 150));
        } catch (e) { break; }
    }
    return allKlines;
}

function calculateHeikinAshi(klines) {
    const haCandles = [];
    for (let i = 0; i < klines.length; i++) {
        const o = parseFloat(klines[i][1]), h = parseFloat(klines[i][2]), l = parseFloat(klines[i][3]), c = parseFloat(klines[i][4]);
        const haClose = (o + h + l + c) / 4;
        let haOpen = i === 0 ? (o + c) / 2 : (haCandles[i - 1].open + haCandles[i - 1].close) / 2;
        const haHigh = Math.max(h, haOpen, haClose), haLow = Math.min(l, haOpen, haClose);
        haCandles.push({ open: haOpen, close: haClose, high: haHigh, low: haLow });
    }
    return haCandles;
}

async function backtest(symbol) {
    const rawData = await fetchHeavyKlines(symbol);
    if (!rawData || rawData.length < 1000) return null;

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
            // EXIT: ATR Target o RSI(2) > 85
            if (currentPrice >= activeTrade.tp || rsiPadded[i] > 85) {
                const pnl = (currentPrice - activeTrade.entry) / activeTrade.entry * 100;
                totalPnL += pnl;
                if (pnl > 0) wins++;
                activeTrade = null;
            } else if (i - activeTrade.index > 288) { // 3 días max (72h / 15m = 288 velas)
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
    console.log(`--- BACKTESTING VORTEX: ÚLTIMOS 3 MESES (15M / VORTEX CORE) ---`);
    let gt = 0, gw = 0, gp = 0;

    for (const s of SYMBOLS) {
        const r = await backtest(s);
        if (r && r.trades > 0) {
            console.log(`✅ ${r.symbol.padEnd(10)} | T: ${r.trades} | WR: ${(r.wins / r.trades * 100).toFixed(1)}% | PnL: +${r.totalPnL.toFixed(2)}%`);
            gt += r.trades; gw += r.wins; gp += r.totalPnL;
        }
    }

    console.log(`\n--- RESULTADO TRIMESTRAL (90 DÍAS) ---`);
    console.log(`Total Trades Realizados: ${gt}`);
    console.log(`WinRate Acumulado: ${((gw / gt) * 100).toFixed(1)}%`);
    console.log(`PROFIT TOTAL NETO (9 Monedas): +${gp.toFixed(2)}%`);
    console.log(`Promedio Mensual Real: +${(gp / 3).toFixed(2)}%`);
    console.log(`Proyección con 20 monedas: +${(gp / 3 * 2.2).toFixed(2)}% / mes`);
}

runAll();
