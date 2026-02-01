import axios from 'axios';
import { RSI, EMA, BollingerBands } from 'technicalindicators';

// PAIRS CONFIG
const PAIRS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
    'ADAUSDT', 'TRXUSDT', 'BNBUSDT', 'AVAXUSDT', 'LINKUSDT'
];

async function runBacktest() {
    console.log(`🔄 Starting Multi-Pair Backtest (Top ${PAIRS.length})...`);
    console.log('Configs: SWING AGGRESSIVE | TP: 6.0% | SL: 3.0% | Window: 30 Days');

    let globalStats = {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        pnlUsd: 0,
        initialBalance: 1000 * PAIRS.length // assuming 1000 per pair
    };

    let detailedReports = [];

    for (const symbol of PAIRS) {
        try {
            await runSinglePair(symbol, globalStats, detailedReports);
            // Rate limit protection
            await new Promise(r => setTimeout(r, 200));
        } catch (e) {
            console.error(`❌ Error on ${symbol}: ${e.message}`);
        }
    }

    // GRAND SUMMARY
    console.log('\n\n=============================================================');
    console.log('🚀 RESULTADOS GLOBALES (TODOS LOS PARES)');
    console.log('=============================================================');
    console.log(`💰 Balance Inicial (Total): $${globalStats.initialBalance.toFixed(2)}`);
    console.log(`💰 Balance Final (Total):   $${(globalStats.initialBalance + globalStats.pnlUsd).toFixed(2)}`);
    console.log(`📈 PnL Neto Total:          $${globalStats.pnlUsd.toFixed(2)}`);
    console.log(`🔢 Total Trades:            ${globalStats.totalTrades}`);
    console.log(`✅ Ganadas:                 ${globalStats.wins}`);
    console.log(`❌ Perdidas:                ${globalStats.losses}`);
    console.log(`🎯 Win Rate Global:         ${globalStats.totalTrades > 0 ? ((globalStats.wins / globalStats.totalTrades) * 100).toFixed(1) : 0}%`);
    console.log('=============================================================');

    // Show best performer
    if (detailedReports.length > 0) {
        detailedReports.sort((a, b) => b.pnl - a.pnl);
        console.log(`🏆 Mejor Par: ${detailedReports[0].symbol} (+$${detailedReports[0].pnl.toFixed(2)})`);
        console.log(`💀 Peor Par:  ${detailedReports[detailedReports.length - 1].symbol} ($${detailedReports[detailedReports.length - 1].pnl.toFixed(2)})`);
    }
}

async function runSinglePair(symbol, globalStats, detailedReports) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=500`;
    let data;
    try {
        const res = await axios.get(url);
        data = res.data;
    } catch (e) {
        console.log(`⚠️ Skip ${symbol}: No data`);
        return;
    }

    // Parse Data
    const closes = data.map(c => parseFloat(c[4]));
    const highs = data.map(c => parseFloat(c[2]));
    const lows = data.map(c => parseFloat(c[3]));
    const times = data.map(c => new Date(c[0]));

    // Indicators
    const rsiValues = RSI.calculate({ values: closes, period: 14 });
    const fullRSI = [...new Array(14).fill(null), ...rsiValues];

    // Params
    const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const startTime = now - ONE_MONTH_MS;

    let balance = 1000; // Per Pair Simulation
    let position = null;
    let localTrades = 0;
    let localWins = 0;
    let localLosses = 0;

    for (let i = 200; i < closes.length; i++) {
        const time = times[i];
        if (time.getTime() < startTime) continue;

        const currentPrice = closes[i];
        const currentRSI = fullRSI[i];
        const high = highs[i];
        const low = lows[i];

        if (!currentRSI) continue;

        // EXIT LOGIC
        if (position) {
            const maxWin = (high - position.entryPrice) / position.entryPrice * 100;
            const maxLoss = (low - position.entryPrice) / position.entryPrice * 100;
            let exitPrice = null;

            // Updated Params: TP 6% | SL 3%
            if (maxWin >= 6.0) {
                exitPrice = position.entryPrice * 1.06;
                localWins++;
            } else if (maxLoss <= -3.0) {
                exitPrice = position.entryPrice * 0.97;
                localLosses++;
            }

            if (exitPrice) {
                const profit = (exitPrice - position.entryPrice) * position.size;
                const fee = (exitPrice * position.size) * 0.001;
                balance += profit - fee;
                localTrades++;
                position = null;
                continue;
            }
        }

        // ENTRY LOGIC (Aggressive: RSI < 30)
        if (!position) {
            if (currentRSI < 30) {
                const size = balance / currentPrice;
                const fee = balance * 0.001;
                balance -= fee;
                position = { entryPrice: currentPrice, size: size };
            }
        }
    }

    const netPnl = balance - 1000;

    // Update Globals
    globalStats.totalTrades += localTrades;
    globalStats.wins += localWins;
    globalStats.losses += localLosses;
    globalStats.pnlUsd += netPnl;

    detailedReports.push({ symbol, pnl: netPnl });

    console.log(`🔹 ${symbol.padEnd(10)} | Trades: ${localTrades} | W/L: ${localWins}/${localLosses} | PnL: $${netPnl.toFixed(2)}`);
}

runBacktest();
