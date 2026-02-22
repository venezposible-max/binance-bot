import axios from 'axios';
import { RSI, ATR } from 'technicalindicators';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'WIFUSDT', 'SUIUSDT', 'FETUSDT', 'AVAXUSDT'];
const INTERVAL = '5m';

async function fetch48hKlines(symbol) {
    let allKlines = [];
    let endTime = Date.now();

    // 48 horas a 5 min = 12 velas/h * 48h = 576 velas
    // 1 request es suficiente (limit 1000)
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${INTERVAL}&limit=600&endTime=${endTime}`;
        const res = await axios.get(url);
        allKlines = res.data;
    } catch (e) {
        console.error(`Error fetching data for ${symbol}:`, e.message);
    }

    return allKlines;
}

async function runBacktest() {
    console.log("--- BACKTESTING UNIXA PURA: ÚLTIMAS 48 HORAS (5M - REAL) ---");

    let totalTrades = 0;
    let wins = 0;
    let losses = 0;
    let timeouts = 0;
    let euphorias = 0;
    let netGain = 0; // Ganancia/Pérdida en % puro sin apalancamiento

    for (const symbol of SYMBOLS) {
        const data = await fetch48hKlines(symbol);

        if (data.length < 50) continue;

        const opens = data.map(d => parseFloat(d[1]));
        const closes = data.map(d => parseFloat(d[4]));
        const highs = data.map(d => parseFloat(d[2]));
        const lows = data.map(d => parseFloat(d[3]));

        const rsiArr = RSI.calculate({ period: 2, values: closes });
        const atrArr = ATR.calculate({ period: 10, high: highs, low: lows, close: closes });

        const rsiPadded = new Array(closes.length - rsiArr.length).fill(50).concat(rsiArr);
        const atrPadded = new Array(closes.length - atrArr.length).fill(0).concat(atrArr);

        // Heikin Ashi approximation (close > open of previous HA) for simple backtest
        // HA Close = (O+H+L+C)/4
        // HA Open = (Prev HA Open + Prev HA Close)/2
        let haOpens = [opens[0]];
        let haCloses = [(opens[0] + highs[0] + lows[0] + closes[0]) / 4];
        for (let i = 1; i < closes.length; i++) {
            haOpens.push((haOpens[i - 1] + haCloses[i - 1]) / 2);
            haCloses.push((opens[i] + highs[i] + lows[i] + closes[i]) / 4);
        }

        let inTrade = false;
        let entryPrice = 0;
        let entryIndex = 0;
        let tp = 0;
        let fee = 0.002; // 0.1% in, 0.1% out

        for (let i = 20; i < closes.length; i++) {
            const currentPrice = closes[i];
            const currentRSI = rsiPadded[i];

            if (!inTrade) {
                // UNIXA CONDITION: RSI(2) < 2
                if (currentRSI < 2.0) {
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
                // 2. Euphoria (RSI > 95)
                else if (currentRSI >= 95) {
                    exitPrice = currentPrice;
                    exitReason = "Euforia (RSI>=95)";
                    euphorias++;
                }
                // 3. Timeout (48 hours = 576 velas de 5m -> For this 48h test, let's use a 12h timeout = 144 velas)
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
                    console.log(`[${symbol}] ${exitReason} | Duración: ${(i - entryIndex) * 5}m | PnL: ${netPct.toFixed(2)}% | Precio Final: $${exitPrice.toFixed(4)}`);

                    inTrade = false;
                }
            }
        }
    }

    console.log(`\n============== RESULTADOS UNIXA (48H) ==============`);
    console.log(`Operaciones: ${totalTrades}`);
    if (totalTrades > 0) {
        console.log(`Tasa Victoria: ${((wins / totalTrades) * 100).toFixed(1)}%`);
        console.log(`Victorias: ${wins} | Perdedoras: ${losses}`);
        console.log(`Rendimiento Neto: ${netGain > 0 ? '+' : ''}${netGain.toFixed(2)}% de Capital Invertido`);
        console.log(`Cierres por Euforia: ${euphorias}`);
        console.log(`Cierres por Aburrimiento: ${timeouts}`);
    } else {
        console.log(`El mercado lateral o alcista no detonó pánikos UNIXA en las últimas 48h.`);
    }
}

runBacktest();
