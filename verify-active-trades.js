import axios from 'axios';
import * as analysis from './src/utils/analysis.js';

async function scanForSignals(symbol, startTimeStr, endTimeStr, interval = '5m') {
    console.log(`\nEscaneando ${symbol} (${interval}) desde ${startTimeStr} hasta ${endTimeStr}...`);
    const start = new Date(startTimeStr).getTime();
    const end = new Date(endTimeStr).getTime();

    const baseUrl = 'https://api.binance.com';
    const res = await axios.get(`${baseUrl}/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&startTime=${start}&endTime=${end}&limit=1000`);
    const allCandles = res.data.map(c => ({
        timestamp: c[0],
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5])
    }));

    for (let i = 20; i < allCandles.length; i++) {
        const slice = allCandles.slice(i - 50 > 0 ? i - 50 : 0, i);
        const result = analysis.analyzeOB(slice, { mode: 'BLITZ' });
        if (result.prediction.signal === 'BUY' || result.prediction.signal === 'BULLISH') {
            const time = new Date(allCandles[i].timestamp).toLocaleString();
            console.log(`[${time}] Señal: ${result.prediction.signal} | ${result.prediction.label} | Precio: $${allCandles[i].close}`);
        }
    }
}

async function run() {
    // Scan 5m interval over the last 4 hours
    const start = '2026-02-01T16:00:00-04:00';
    const end = '2026-02-01T20:50:00-04:00';

    console.log("--- SCANNING 5m INTERVAL ---");
    await scanForSignals('LINK', start, end, '5m');
    await scanForSignals('ADA', start, end, '5m');
    await scanForSignals('ETH', start, end, '5m');
}

run().catch(console.error);
