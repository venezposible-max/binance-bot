import axios from 'axios';
import { RSI, ATR } from 'technicalindicators';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'WIFUSDT', 'SUIUSDT', 'FETUSDT', 'AVAXUSDT'];
const INTERVAL = '5m';

// OPTIMAL CONFIGURATION #1
const CONF = {
    rsiIn: 2.0,
    tpAtr: 2.0,
    euforia: 95,
    timeoutVelas: 288 // 24 hours
};

async function fetch24hKlines(symbol) {
    let allKlines = [];
    let endTime = Date.now();
    try {
        // 24 horas a 5 min = 12 velas/h * 24h = 288 velas. Pedimos 350 por calcular ATR/RSI.
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${INTERVAL}&limit=350&endTime=${endTime}`;
        const res = await axios.get(url);
        allKlines = res.data;
    } catch (e) {
        console.error(`Error fetching data for ${symbol}:`, e.message);
    }
    return allKlines;
}

async function runBacktest() {
    console.log("--- BACKTESTING CONFIG #1 UNIXA: ÚLTIMAS 24 HORAS (5M - REAL) ---");

    let totalTrades = 0;
    let wins = 0;
    let losses = 0;
    let netGain = 0;
    let euphorias = 0;
    let tps = 0;
    let timeouts = 0;

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
        let tp = 0;
        let fee = 0.002;

        for (let i = 20; i < closes.length; i++) {
            const currentPrice = closes[i];
            const currentRSI = rsiPadded[i];

            if (!inTrade) {
                if (currentRSI < CONF.rsiIn) {
                    inTrade = true;
                    entryPrice = currentPrice;
                    entryIndex = i;

                    tp = entryPrice + (atrPadded[i] * CONF.tpAtr);
                    tp = Math.max(tp, entryPrice * 1.004); // Default minimum 0.4% taking into account fees
                }
            } else {
                let exitReason = null;
                let exitPrice = 0;

                // 1. Take Profit ATR
                if (highs[i] >= tp) {
                    exitPrice = tp;
                    exitReason = "TP Natural (ATR 2x)";
                    tps++;
                }
                // 2. Euphoria
                else if (currentRSI >= CONF.euforia) {
                    exitPrice = currentPrice;
                    exitReason = "Euforia Salvavidas (RSI 95)";
                    euphorias++;
                }
                // 3. Timeout
                else if (i - entryIndex >= CONF.timeoutVelas) {
                    exitPrice = currentPrice;
                    exitReason = "Timeout 24H";
                    timeouts++;
                }
                // Forzar cierre final de data (simulando trade abierto)
                else if (i === closes.length - 1) {
                    exitPrice = currentPrice;
                    exitReason = "Trade Abierto al Cierre";
                }

                if (exitReason) {
                    const grossPct = ((exitPrice - entryPrice) / entryPrice) * 100;
                    const netPct = grossPct - (fee * 100);

                    totalTrades++;
                    if (netPct > 0) wins++;
                    else losses++;

                    netGain += netPct;
                    console.log(`[${symbol}] ${exitReason} | Duración: ${(i - entryIndex) * 5}m | PnL: ${netPct > 0 ? '+' : ''}${netPct.toFixed(2)}% | Precio Final: $${exitPrice.toFixed(4)}`);

                    inTrade = false;
                }
            }
        }
    }

    console.log(`\n============== RESULTADOS CONFIG #1 (ÚLTIMAS 24H) ==============`);
    console.log(`Operaciones: ${totalTrades}`);
    if (totalTrades > 0) {
        console.log(`Tasa Victoria: ${((wins / totalTrades) * 100).toFixed(1)}%`);
        console.log(`Victorias: ${wins} | Perdedoras: ${losses}`);
        console.log(`Rendimiento Neto: ${netGain > 0 ? '+' : ''}${netGain.toFixed(2)}% de Capital Invertido`);
        console.log(`Desglose: ${tps} TP Exitosos | ${euphorias} Cierres Pánico | ${timeouts} Aburrimiento`);
    } else {
        console.log(`No hubieron colapsos en 24 horas para operar.`);
    }
}

runBacktest();
