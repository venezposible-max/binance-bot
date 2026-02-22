import axios from 'axios';
import { RSI, ATR } from 'technicalindicators';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'WIFUSDT'];
const INTERVAL = '5m';

async function fetchHeavyKlines(symbol) {
    let allKlines = [];
    let endTime = Date.now();
    for (let i = 0; i < 5; i++) { // Últimos 14 días aprox (5 request de 1000 velas de 5m = 5000 velas)
        try {
            const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${INTERVAL}&limit=1000&endTime=${endTime}`;
            const res = await axios.get(url);
            if (!res.data || res.data.length === 0) break;
            allKlines = res.data.concat(allKlines);
            endTime = res.data[0][0] - 1;
        } catch (e) { break; }
    }
    return allKlines;
}

async function runGridSearch() {
    console.log("🚀 DESCARGANDO HISTORIAL DE 14 DÍAS PARA OPTIMIZACIÓN UNIXA...");
    const marketData = {};
    for (const sym of SYMBOLS) {
        marketData[sym] = await fetchHeavyKlines(sym);
    }
    console.log("✅ DATOS LISTOS. INICIANDO BÚSQUEDA DE PARÁMETROS...\n");

    const entryRSI_Options = [1.5, 2.0, 3.0];
    const takeProfitATR_Options = [1.5, 2.0, 2.5, 3.0];
    const euphoriaRSI_Options = [80, 90, 95, "OFF"];
    const timeoutVelas_Options = [72, 144, 288]; // 6h, 12h, 24h

    let bestConfig = null;
    let bestNetGain = -9999;
    let resultsList = [];

    let totalCombinations = entryRSI_Options.length * takeProfitATR_Options.length * euphoriaRSI_Options.length * timeoutVelas_Options.length;
    let comboCount = 0;

    for (const rsiIn of entryRSI_Options) {
        for (const tpMult of takeProfitATR_Options) {
            for (const rsiOut of euphoriaRSI_Options) {
                for (const timeout of timeoutVelas_Options) {
                    comboCount++;

                    let netGain = 0;
                    let wins = 0;
                    let total = 0;

                    for (const symbol of SYMBOLS) {
                        const data = marketData[symbol];
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
                                // MODIFICACIÓN: Condicion estricta sin HA para Unixa actual
                                if (currentRSI < rsiIn) {
                                    inTrade = true;
                                    entryPrice = currentPrice;
                                    entryIndex = i;
                                    tp = entryPrice + (atrPadded[i] * tpMult);
                                    tp = Math.max(tp, entryPrice * 1.004); // Minimo 0.4% por si el ATR es muy chico
                                }
                            } else {
                                let exitPrice = 0;

                                // 1. Take Profit ATR
                                if (highs[i] >= tp) { exitPrice = tp; }
                                // 2. Euphoria
                                else if (rsiOut !== "OFF" && currentRSI >= rsiOut) { exitPrice = currentPrice; }
                                // 3. Timeout
                                else if (i - entryIndex >= timeout) { exitPrice = currentPrice; }
                                // 4. Fin de data
                                else if (i === closes.length - 1) { exitPrice = currentPrice; }

                                if (exitPrice > 0) {
                                    const netPct = (((exitPrice - entryPrice) / entryPrice) * 100) - (fee * 100);
                                    total++;
                                    if (netPct > 0) wins++;
                                    netGain += netPct;
                                    inTrade = false;
                                }
                            }
                        }
                    }

                    resultsList.push({
                        config: `RSI In: ${rsiIn} | TP ATR: ${tpMult}x | Euforia: ${rsiOut} | Max Horas: ${timeout / 12}h`,
                        netGain,
                        winRate: total > 0 ? (wins / total) * 100 : 0,
                        trades: total
                    });

                    if (netGain > bestNetGain && total > 5) {
                        bestNetGain = netGain;
                        bestConfig = resultsList[resultsList.length - 1];
                    }
                }
            }
        }
    }

    // Sort to get top 5
    resultsList.sort((a, b) => b.netGain - a.netGain);

    console.log("🏆 TOP 5 MEJORES COMBINACIONES PARA UNIXA (Últimos 14 días):");
    for (let i = 0; i < 5; i++) {
        const r = resultsList[i];
        console.log(`#${i + 1} -> Rendimiento: ${r.netGain.toFixed(2)}% | WinRate: ${r.winRate.toFixed(1)}% | Trades: ${r.trades}`);
        console.log(`      Config: ${r.config}\n`);
    }
}

runGridSearch();
