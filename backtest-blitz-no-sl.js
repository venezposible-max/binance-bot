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
        await new Promise(r => setTimeout(r, 50));
        if (currentStart >= end) break;
    }
    return all.filter(c => c.timestamp <= end);
}

async function runBacktest() {
    const DAYS = 7;
    const MAX_TRADES = 5;
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'BNBUSDT', 'AVAXUSDT', 'LINKUSDT'];

    console.log(`🚀 STARTING REFINED BLITZ BACKTEST (FULL 7 DAYS, GLOBAL MAX ${MAX_TRADES} TRADES, NO SL)`);
    console.log(`-----------------------------------------------------------------------`);

    const allCandles = {};
    const endTime = Date.now();
    const startTime = endTime - (DAYS * 24 * 60 * 60 * 1000);

    for (const symbol of symbols) {
        console.log(`.. Descargando datos para ${symbol}...`);
        allCandles[symbol] = await fetchAllCandles(symbol, startTime, endTime);
    }

    // 2. Simulate time step-by-step (every 5 minutes)
    let globalProfit = 0;
    let totalTradesCount = 0;
    let winningTrades = 0;
    const activeTrades = []; // { symbol, entryPrice, tpPrice, entryTime }
    const symbolStats = {};
    symbols.forEach(s => symbolStats[s] = { trades: 0, profit: 0 });
    const tradesLog = [];

    const minLen = Math.min(...Object.values(allCandles).map(c => c.length));

    for (let i = 50; i < minLen; i++) {
        // Step A: Check Exits first
        for (let j = activeTrades.length - 1; j >= 0; j--) {
            const trade = activeTrades[j];
            const currentCandle = allCandles[trade.symbol][i];

            // Check TP (Exit)
            if (currentCandle.close >= trade.tpPrice) {
                const pnl = ((trade.tpPrice - trade.entryPrice) / trade.entryPrice) * 100;
                const netPnl = (pnl - 0.2); // Fee deduction
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

                activeTrades.splice(j, 1); // Close trade
            }
        }

        // Step B: Check Entries
        if (activeTrades.length < MAX_TRADES) {
            for (const symbol of symbols) {
                // Don't enter if already in this symbol
                if (activeTrades.some(t => t.symbol === symbol)) continue;
                if (activeTrades.length >= MAX_TRADES) break;

                const slice = allCandles[symbol].slice(0, i);
                const currentPrice = allCandles[symbol][i].close;

                const result = analysis.analyzeOB(slice, { mode: 'BLITZ' });
                // AGGRESSIVE ENTRY: Allow entry on 'BULLISH' (OB High) instead of just 'BUY' (OB Midpoint)
                if (result.prediction.signal === 'BULLISH' || result.prediction.signal === 'BUY') {
                    if (result.obZone && currentPrice <= result.obZone.high) {
                        const atr = result.indicators.atr;
                        const tpPrice = currentPrice + (2.5 * parseFloat(atr));

                        activeTrades.push({
                            symbol,
                            entryPrice: currentPrice,
                            tpPrice,
                            entryTime: allCandles[symbol][i].timestamp
                        });
                        symbolStats[symbol].trades++;
                        totalTradesCount++;
                    }
                }
            }
        }
    }

    console.log(`-----------------------------------------------------------------------`);
    console.log(`DETALLE DE OPERACIONES REALIZADAS:`);
    console.log(`-----------------------------------------------------------------------`);
    tradesLog.forEach((t, idx) => {
        console.log(`${idx + 1}. [${t.symbol}] | Entrada: $${t.entry.toFixed(4)} | Salida: $${t.exit.toFixed(4)} | PnL: +${t.pnl.toFixed(2)}% | Fecha: ${t.time}`);
    });

    console.log(`-----------------------------------------------------------------------`);
    console.log(`RESULTADOS ACUMULADOS POR MONEDA:`);
    symbols.forEach(s => {
        if (symbolStats[s].trades > 0) {
            console.log(`${s.padEnd(8)} | Trades: ${symbolStats[s].trades} | Profit Acumulado: ${symbolStats[s].profit.toFixed(2)}%`);
        } else {
            console.log(`${s.padEnd(8)} | Sin señales en este periodo`);
        }
    });

    console.log(`-----------------------------------------------------------------------`);
    console.log(`✅ COMPLETE.`);
    console.log(`Rentabilidad Total: ${globalProfit.toFixed(2)}%`);
    console.log(`Trades Totales: ${totalTradesCount}`);
    console.log(`Win Rate: ${totalTradesCount > 0 ? ((winningTrades / totalTradesCount) * 100).toFixed(1) : 0}%`);
    console.log(`Trades abiertos al final: ${activeTrades.length}`);
    console.log(`-----------------------------------------------------------------------`);
}

runBacktest().catch(console.error);
