import axios from 'axios';
import { RSI, ATR } from 'technicalindicators';
import * as analysis from '../src/utils/analysis.js';

async function fetchLast24hData(symbol) {
    const baseUrl = 'https://api.binance.com';
    const url = `${baseUrl}/api/v3/klines?symbol=${symbol}&interval=1m&limit=1440`; // 24 hours in 1m candles
    try {
        const { data } = await axios.get(url);
        return data.map(c => ({
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5])
        }));
    } catch (e) {
        return null;
    }
}

async function simulateToday() {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'LINKUSDT'];
    console.log(`\n🕵️‍♂️ ANALIZANDO LAS ÚLTIMAS 24 HORAS (Turbo Blitz Mode)`);
    console.log(`----------------------------------------------------------`);

    let totalOp = 0;

    for (const symbol of symbols) {
        const history = await fetchLast24hData(symbol);
        if (!history) continue;

        const highs = history.map(h => h.high);
        const lows = history.map(h => h.low);
        const closes = history.map(h => h.close);

        const rsiValues = RSI.calculate({ values: closes, period: 14 });
        const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

        let activeTrades = [];
        let tradeCount = 0;

        for (let i = 20; i < history.length; i++) {
            const currentPrice = history[i].close;
            const currentRSI = rsiValues[i - 14] || 50;
            const currentATR = atrValues[i - 14] || currentPrice * 0.01;

            // 1. EXIT
            activeTrades = activeTrades.filter(trade => {
                if (currentPrice >= trade.tp || currentPrice <= trade.sl) {
                    return false;
                }
                return true;
            });

            // 2. ENTRY (Turbo Blitz: Impulse 0.8% + RSI < 35)
            if (activeTrades.length === 0) {
                const prevOpen = history[i - 1].open;
                const impulse = ((currentPrice - prevOpen) / prevOpen) * 100;

                if (impulse >= 0.8 && currentRSI < 40) { // Slight RSI relaxation for 1m
                    tradeCount++;
                    activeTrades.push({
                        entryPrice: currentPrice,
                        tp: currentPrice + (currentATR * 2.5),
                        sl: currentPrice - (currentATR * 1.5)
                    });
                }
            }
        }
        console.log(`🔹 ${symbol.padEnd(10)} | Oportunidades detectadas: ${tradeCount}`);
        totalOp += tradeCount;
    }

    console.log(`----------------------------------------------------------`);
    console.log(`🚀 TOTAL OPORTUNIDADES HOY: ${totalOp}`);
    console.log(`----------------------------------------------------------\n`);
}

simulateToday();
