import axios from 'axios';
import { RSI, ATR } from 'technicalindicators';
import * as analysis from '../src/utils/analysis.js';

const CONFIG = {
    symbol: 'SOLUSDT',
    initialBalance: 1000,
    riskPercentage: 10,
    interval: '5m',
    months: 3, // Reduced to 3 months for faster download but higher density
    region: 'EU'
};

async function fetchBlitzData() {
    const baseUrl = CONFIG.region === 'EU' ? 'https://api.binance.com' : 'https://api.binance.us';
    const totalCandles = CONFIG.months * 30 * 24 * 12;
    let allKlines = [];
    let endTime = Date.now();
    console.log(`⏳ Descargando ~25,000 velas para Validación ATR (${CONFIG.symbol})...`);
    while (allKlines.length < totalCandles) {
        const url = `${baseUrl}/api/v3/klines?symbol=${CONFIG.symbol}&interval=${CONFIG.interval}&limit=1000&endTime=${endTime}`;
        try {
            const { data } = await axios.get(url);
            if (!data || data.length === 0) break;
            allKlines = [...data, ...allKlines];
            endTime = data[0][0] - 1;
            process.stdout.write(`\rDescargado: ${allKlines.length} / ${totalCandles}`);
        } catch (e) { break; }
    }
    return allKlines.map(c => ({ open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]) }));
}

async function runEliteBlitzBacktest() {
    try {
        const history = await fetchBlitzData();
        const highs = history.map(h => h.high);
        const lows = history.map(h => h.low);
        const closes = history.map(h => h.close);

        const rsiValues = RSI.calculate({ values: closes, period: 14 });
        const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

        let balance = CONFIG.initialBalance;
        let activeTrades = [];
        let tradeHistory = [];
        let peakBalance = balance;
        let maxDrawdown = 0;

        console.log(`\n👑 [TEST DE ESTRATEGIA ATR] | ${CONFIG.symbol} | 3 MESES`);
        console.log(`🎯 Parámetros: TP (2.5x ATR) | SL (1.5x ATR) | Entry (RSI < 35)`);
        console.log(`----------------------------------------------------------`);

        for (let i = 20; i < history.length; i++) {
            const currentPrice = history[i].close;
            const rsiIdx = i - 14;
            const currentRSI = rsiValues[rsiIdx] || 50;
            const currentATR = atrValues[rsiIdx] || currentPrice * 0.01;

            // 1. EXIT (Mirroring Production)
            activeTrades = activeTrades.filter(trade => {
                const isTp = currentPrice >= trade.tp;
                const isSl = currentPrice <= trade.sl;

                if (isTp || isSl) {
                    const pnl = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
                    const finalPnl = (trade.invested * pnl) / 100;
                    balance += trade.invested + finalPnl;
                    tradeHistory.push({ pnl: finalPnl });

                    if (balance > peakBalance) peakBalance = balance;
                    const dd = ((peakBalance - balance) / peakBalance) * 100;
                    if (dd > maxDrawdown) maxDrawdown = dd;
                    return false;
                }
                return true;
            });

            // 2. ENTRY (Optimized for visible results)
            if (activeTrades.length === 0 && currentRSI < 35) {
                const risk = CONFIG.riskPercentage / 100;
                const invested = balance * risk;

                balance -= invested;
                activeTrades.push({
                    entryPrice: currentPrice,
                    invested,
                    // DINAMISMO ATR:
                    tp: currentPrice + (currentATR * 2.5),
                    sl: currentPrice - (currentATR * 1.5)
                });
            }
        }

        const totalProfit = balance - CONFIG.initialBalance;
        console.log(`\n📊 REPORTE DE VOLATILIDAD`);
        console.log(`----------------------------------------------------------`);
        console.log(`🏁 Balance Final:  $${balance.toFixed(2)}`);
        console.log(`🥇 Ganancia Total: $${totalProfit.toFixed(2)} (${((totalProfit / CONFIG.initialBalance) * 100).toFixed(2)}%)`);
        console.log(`🎯 Op. Cerradas:   ${tradeHistory.length}`);
        console.log(`📈 Win Rate:       ${(tradeHistory.filter(t => t.pnl > 0).length / tradeHistory.length * 100).toFixed(1)}%`);
        console.log(`📉 Max Drawdown:   ${maxDrawdown.toFixed(2)}%`);
        console.log(`----------------------------------------------------------\n`);

    } catch (e) { console.error(e.message); }
}

runEliteBlitzBacktest();
