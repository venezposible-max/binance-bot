import axios from 'axios';
import * as analysis from './src/utils/analysis.js';

const TOP_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'BNBUSDT', 'AVAXUSDT', 'LINKUSDT', 'BCHUSDT', 'NEARUSDT'];

async function checkSignalsSince(startTime) {
    let totalSignals = 0;
    console.log(`🔍 Escaneando señales BLITZ + HYBRID desde ${new Date(startTime).toLocaleString()} (UTC)...`);

    for (const symbol of TOP_PAIRS) {
        try {
            const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&startTime=${startTime}&limit=1000`;
            const { data } = await axios.get(url);

            if (!data || !Array.isArray(data)) continue;

            const allCandles = data.map(c => ({
                timestamp: c[0],
                open: parseFloat(c[1]),
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
                volume: parseFloat(c[5])
            }));

            for (let i = 50; i < allCandles.length; i++) {
                const slice = allCandles.slice(i - 50, i + 1);
                const res = analysis.analyzeBlitz(null, slice);

                const blitzOk = res.prediction?.signal.includes('BUY') && res.prediction.intensity > 30;
                const odds = parseFloat(res.indicators.hybrid?.odds || 50);
                const hybridOk = odds >= 67;

                if (blitzOk && hybridOk) {
                    const signalTime = new Date(allCandles[i].timestamp).toLocaleString('es-VE');
                    console.log(`[${signalTime}] 🚀 SEÑAL: ${symbol} | Odds: ${odds}% | Blitz Intensity: ${res.prediction.intensity}`);
                    totalSignals++;
                    i += 6;
                } else if (blitzOk) {
                    // console.log(`[${symbol}] Blitz OK but Hybrid Odds: ${odds}%`);
                }
            }
        } catch (e) {
            console.error(`Error en ${symbol}: ${e.message}`);
        }
    }
    console.log(`\n✅ TOTAL SEÑALES ENCONTRADAS: ${totalSignals}`);
}

const startTime = new Date('2026-03-15T03:00:00Z').getTime();
checkSignalsSince(startTime);
