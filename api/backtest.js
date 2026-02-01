import axios from 'axios';
import { RSI } from 'technicalindicators';
import * as analysis from '../src/utils/analysis.js';

const CONFIG = {
    symbol: 'SOLUSDT',
    initialBalance: 1000,
    riskPercentage: 10,
    interval: '5m',
    months: 5,
    region: 'EU'
};

async function fetchBlitzData() {
    const baseUrl = CONFIG.region === 'EU' ? 'https://api.binance.com' : 'https://api.binance.us';
    const totalCandles = CONFIG.months * 30 * 24 * 12; // 5 months in 5m periods
    let allKlines = [];
    let endTime = Date.now();

    console.log(`⏳ Descargando ~43,000 velas de Blitz (5m)...`);

    // Download in chunks of 1000
    while (allKlines.length < totalCandles) {
        const url = `${baseUrl}/api/v3/klines?symbol=${CONFIG.symbol}&interval=${CONFIG.interval}&limit=1000&endTime=${endTime}`;
        try {
            const { data } = await axios.get(url);
            if (!data || data.length === 0) break;

            allKlines = [...data, ...allKlines];
            endTime = data[0][0] - 1;
            process.stdout.write(`\rDescargado: ${allKlines.length} / ${totalCandles}`);
        } catch (e) {
            console.error('\nError en descarga:', e.message);
            break;
        }
    }
    console.log('\n✅ Datos cargados.');

    return allKlines.map(c => ({
        timestamp: c[0],
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5])
    }));
}

async function runBlitzBacktest() {
    try {
        const history = await fetchBlitzData();
        const closes = history.map(h => h.close);

        // Pre-calculate RSI for speed
        const rsiValues = RSI.calculate({ values: closes, period: 14 });

        let balance = CONFIG.initialBalance;
        let activeTrades = [];
        let tradeHistory = [];
        let peakBalance = balance;
        let maxDrawdown = 0;

        console.log(`\n⚡ [SIMULADOR BLITZ 5m] | ${CONFIG.symbol} | 5 MESES`);
        console.log(`💰 Capital: $${CONFIG.initialBalance} | Riesgo: ${CONFIG.riskPercentage}%`);
        console.log(`----------------------------------------------------------`);

        for (let i = 20; i < history.length; i++) {
            const currentPrice = history[i].close;
            const currentRSI = rsiValues[i - 14] || 50;

            // 1. EXIT (Fast exits for Blitz - Optimized RR)
            activeTrades = activeTrades.filter(trade => {
                const pnl = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
                const isTp = pnl >= 1.2;
                const isSl = pnl <= -0.7;

                if (isTp || isSl) {
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

            // 2. ENTRY (Blitz Logic + Trend Filter)
            if (activeTrades.length === 0) {
                // Elite Blitz: Oversold + Price stabilizing
                if (currentRSI < 20) {
                    const riskMult = analysis.calculateKelly(tradeHistory);
                    const risk = (CONFIG.riskPercentage * riskMult) / 100;
                    const invested = balance * risk;
                    balance -= invested;
                    activeTrades.push({ entryPrice: currentPrice, invested });
                }
            }
        }

        const totalProfit = balance - CONFIG.initialBalance;
        const wins = tradeHistory.filter(t => t.pnl > 0).length;
        const winRate = (wins / tradeHistory.length) * 100 || 0;

        console.log(`\n📊 RESULTADO FINAL BLITZ`);
        console.log(`----------------------------------------------------------`);
        console.log(`🏁 Balance Final:  $${balance.toFixed(2)}`);
        console.log(`📈 Ganancia Total: $${totalProfit.toFixed(2)} (${((totalProfit / CONFIG.initialBalance) * 100).toFixed(2)}%)`);
        console.log(`🎯 Win Rate:      ${winRate.toFixed(1)}% (${tradeHistory.length} trades)`);
        console.log(`📉 Max Drawdown:  ${maxDrawdown.toFixed(2)}%`);
        console.log(`----------------------------------------------------------\n`);

    } catch (e) {
        console.error('Error:', e.message);
    }
}

runBlitzBacktest();
