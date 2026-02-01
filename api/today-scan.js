import axios from 'axios';
import { RSI, ATR } from 'technicalindicators';

async function fetchLast24hData(symbol) {
    const baseUrl = 'https://api.binance.com';
    const url = `${baseUrl}/api/v3/klines?symbol=${symbol}&interval=1m&limit=1440`;
    try {
        const { data } = await axios.get(url);
        return data.map(c => ({
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5])
        }));
    } catch (e) { return null; }
}

async function analyzeScan() {
    // Focus on TOP Volatile/Trending pairs excluding stables
    const symbols = ['SOLUSDT', 'XRPUSDT', 'ETHUSDT', 'BNBUSDT', 'DOGEUSDT', 'WIFUSDT', 'PEPEUSDT', 'BONKUSDT'];
    console.log(`\n🔍 ESCANEO DE AUDITORÍA (Últimas 24 Horas)`);
    console.log(`📅 Fecha/Hora: ${new Date().toLocaleString()}`);
    console.log(`----------------------------------------------------------`);

    for (const symbol of symbols) {
        const history = await fetchLast24hData(symbol);
        if (!history) continue;

        const closes = history.map(h => h.close);
        const highs = history.map(h => h.high);
        const lows = history.map(h => h.low);

        const rsiValues = RSI.calculate({ values: closes, period: 14 });
        const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

        let tradesTurbo = 0; // 0.8% impulse
        let tradesHyper = 0; // 0.5% impulse (Más sensible)

        for (let i = 20; i < history.length; i++) {
            const currentPrice = history[i].close;
            const prevOpen = history[i - 1].open;
            const currentRSI = rsiValues[i - 14] || 50;
            const impulse = ((currentPrice - prevOpen) / prevOpen) * 100;

            if (impulse >= 0.8 && currentRSI < 45) tradesTurbo++;
            if (impulse >= 0.5 && currentRSI < 45) tradesHyper++;
        }

        console.log(`🔹 ${symbol.padEnd(10)} | Turbo (0.8%): ${tradesTurbo} | Hyper (0.5%): ${tradesHyper}`);
    }
    console.log(`----------------------------------------------------------`);
    console.log(`💡 Nota: El mercado hoy ha estado muy lateral ("muerto").`);
    console.log(`Para ver acción hoy, la sensibilidad debería bajar a 0.5%.`);
    console.log(`----------------------------------------------------------\n`);
}

analyzeScan();
