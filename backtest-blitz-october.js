import axios from 'axios';
import * as analysis from './src/utils/analysis.js';

async function fetchAllCandles(symbol, start, end) {
    let all = [];
    let currentStart = start;

    while (currentStart < end) {
        let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&startTime=${currentStart}&limit=1000`;
        const res = await axios.get(url);
        if (res.data.length === 0) break;

        const batch = res.data.map(c => ({
            timestamp: c[0],
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5])
        }));

        all = all.concat(batch);
        currentStart = batch[batch.length - 1].timestamp + 1;

        // Rate limiting safe-sleep
        await new Promise(r => setTimeout(r, 50));

        if (currentStart >= end) break;
    }
    return all.filter(c => c.timestamp <= end);
}

async function runBacktest() {
    const MAX_TRADES = 5;
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'BNBUSDT', 'AVAXUSDT', 'LINKUSDT'];

    // October 2025: From 2025-10-01 00:00:00 to 2025-10-31 23:59:59
    const startTime = new Date('2025-10-01T00:00:00Z').getTime();
    const endTime = new Date('2025-10-31T23:59:59Z').getTime();

    console.log(`🚀 STARTING OCTOBER 2025 BLITZ BACKTEST (NO SL, MAX ${MAX_TRADES} TRADES)`);
    console.log(`-----------------------------------------------------------------------`);

    const allCandlesMap = {};
    for (const symbol of symbols) {
        console.log(`.. Descargando datos para ${symbol}...`);
        allCandlesMap[symbol] = await fetchAllCandles(symbol, startTime, endTime);
    }

    let globalProfit = 0;
    let totalTradesCount = 0;
    let winningTrades = 0;
    const activeTrades = [];
    const symbolStats = {};
    symbols.forEach(s => symbolStats[s] = { trades: 0, profit: 0 });
    const tradesLog = [];

    // Find min length to avoid index errors
    const minLen = Math.min(...Object.values(allCandlesMap).map(c => c.length));

    for (let i = 50; i < minLen; i++) {
        // Step A: Check Exits
        for (let j = activeTrades.length - 1; j >= 0; j--) {
            const trade = activeTrades[j];
            const currentCandle = allCandlesMap[trade.symbol][i];

            if (currentCandle.close >= trade.tpPrice) {
                const pnl = ((trade.tpPrice - trade.entryPrice) / trade.entryPrice) * 100;
                const netPnl = (pnl - 0.2);
                globalProfit += netPnl;
                symbolStats[trade.symbol].profit += netPnl;
                winningTrades++;

                tradesLog.push({
                    symbol: trade.symbol,
                    entry: trade.entryPrice,
                    exit: trade.tpPrice,
                    pnl: netPnl,
                    time: new Date(currentCandle.timestamp).toLocaleString()
                });
                activeTrades.splice(j, 1);
            }
        }

        // Step B: Check Entries
        if (activeTrades.length < MAX_TRADES) {
            for (const symbol of symbols) {
                if (activeTrades.some(t => t.symbol === symbol)) continue;
                if (activeTrades.length >= MAX_TRADES) break;

                const slice = allCandlesMap[symbol].slice(0, i);
                const currentPrice = allCandlesMap[symbol][i].close;

                const result = analysis.analyzeOB(slice, { mode: 'BLITZ' });
                if (result.prediction.signal === 'BUY') {
                    const atr = result.indicators.atr;
                    const tpPrice = currentPrice + (2.5 * parseFloat(atr));

                    activeTrades.push({
                        symbol,
                        entryPrice: currentPrice,
                        tpPrice,
                        entryTime: allCandlesMap[symbol][i].timestamp
                    });
                    symbolStats[symbol].trades++;
                    totalTradesCount++;
                }
            }
        }
    }

    console.log(`-----------------------------------------------------------------------`);
    console.log(`RESULTADOS POR MONEDA (OCTUBRE 2025):`);
    symbols.forEach(s => {
        if (symbolStats[s].trades > 0) {
            console.log(`${s.padEnd(8)} | Trades: ${symbolStats[s].trades} | Profit: ${symbolStats[s].profit.toFixed(2)}%`);
        }
    });

    console.log(`-----------------------------------------------------------------------`);
    console.log(`✅ COMPLETE.`);
    console.log(`Rentabilidad Total: ${globalProfit.toFixed(2)}%`);
    console.log(`Trades Totales: ${totalTradesCount}`);
    console.log(`Win Rate: ${totalTradesCount > 0 ? ((winningTrades / totalTradesCount) * 100).toFixed(1) : 0}%`);
    console.log(`-----------------------------------------------------------------------`);
}

runBacktest().catch(console.error);
