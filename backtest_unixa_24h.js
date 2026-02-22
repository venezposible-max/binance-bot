import axios from 'axios';
import { RSI, ATR } from 'technicalindicators';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'WIFUSDT', 'SUIUSDT', 'FETUSDT', 'AVAXUSDT'];
const INTERVAL = '5m';

async function fetch24hKlines(symbol) {
    let allKlines = [];
    let endTime = Date.now();

    // 24 horas a 5 min = 12 velas/h * 24h = 288 velas
    // 1 request es suficiente (limit 1000)
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${INTERVAL}&limit=500&endTime=${endTime}`;
        const res = await axios.get(url);
        allKlines = res.data;
    } catch (e) {}

    return allKlines;
}

async function runBacktest() {
    console.log("--- BACKTESTING UNIXA PURA: ÚLTIMAS 24 HORAS (5M - REAL) ---");

    let totalTrades = 0;
    let wins = 0;
    let losses = 0;
    let timeouts = 0;
    let euphorias = 0;
    let netGain = 0; // Ganancia/Pérdida en % puro sin apalancamiento

    for (const symbol of SYMBOLS) {
        const data = await fetch24hKlines(symbol);

        if (data.length < 50) continue;

        const closes = data.map(d => parseFloat(d[4]));
        const highs = data.map(d => parseFloat(d[2]));
        const lows = data.map(d => parseFloat(d[3]));

        const rsiArr = RSI.calculate({ period: 2, values: closes });
        const atrArr = ATR.calculate({ period: 10, high: highs, low: lows, close: closes });

        const rsiPadded = new Array(closes.length - rsiArr.length).fill(50).concat(rsiArr);
        const atrPadded = new Array(closes.length - atrArr.length).fill(0).concat(atrArr);

        let inTrade = false;
        let entryPrice = 0;
        let entryIndex = 0;
        let sl = 0;
        let tp = 0;
        let fee = 0.002; // 0.1% in, 0.1% out

        for (let i = 20; i < closes.length; i++) {
            const currentPrice = closes[i];
            const currentRSI = rsiPadded[i];

            if (!inTrade) {
                // UNIXA CONDITION: RSI(2) < 2 + HEIKIN ASHI VERDE CONFIRMATION (Aproximación simple con closes para backtest rápido)
                const isGreen = closes[i] > data[i][1];
                if (currentRSI < 2.0 && isGreen) {
                    inTrade = true;
                    entryPrice = currentPrice;
                    entryIndex = i;

                    tp = entryPrice + (atrPadded[i] * 2.5);
                    tp = Math.max(tp, entryPrice * 1.006);
                }
            } else {
                // ACTIVE TRADE MONITORING (UNIXA RULES)
                let exitReason = null;
                let exitPrice = 0;

                // 1. Take Profit
                if (highs[i] >= tp) {
                    exitPrice = tp;
                    exitReason = "TP Natural";
                }
                // 2. Euphoria (RSI > 80)
                else if (currentRSI >= 80) {
                    exitPrice = currentPrice;
                    exitReason = "Euforia (RSI>=80)";
                    euphorias++;
                }
                // 3. Timeout (48 hours = 576 velas de 5m -> pero como solo pedimos 24h, probemos 12H timeout = 144 velas)
                else if (i - entryIndex >= 144) {
                    exitPrice = currentPrice;
                    exitReason = "Timeout ABURRIMIENTO";
                    timeouts++;
                }
                // Forzar cierre si es la última vela
                else if (i === closes.length - 1) {
                     exitPrice = currentPrice;
                     exitReason = "FIN DEL PERIODO";
                }

                if (exitReason) {
                    // Pnl en %
                    const grossPct = ((exitPrice - entryPrice) / entryPrice) * 100;
                    const netPct = grossPct - (fee * 100);

                    totalTrades++;
                    if (netPct > 0) wins++;
                    else losses++;

                    netGain += netPct;
                    console.log(`[${symbol}] ${exitReason} | Duración: ${(i - entryIndex) * 5}m | PnL: ${netPct.toFixed(2)}%`);

                    inTrade = false;
                }
            }
        }
    }

    console.log(`\n============== RESULTADOS UNIXA (24H) ==============`);
    console.log(`Operaciones: ${totalTrades}`);
    if (totalTrades > 0) {
        console.log(`Tasa Victoria: ${((wins/totalTrades)*100).toFixed(1)}%`);
        console.log(`Victorias: ${wins} | Perdedoras: ${losses}`);
        console.log(`Rendimiento Neto: ${netGain > 0 ? '+' : ''}${netGain.toFixed(2)}% de Capital Invertido`);
        console.log(`Cierres por Euforia: ${euphorias}`);
        console.log(`Cierres por Aburrimiento: ${timeouts}`);
    } else {
        console.log(`El mercado lateral o alcista no detonó pánikos UNIXA hoy.`);
    }
}

runBacktest();
