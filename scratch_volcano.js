import axios from 'axios';
import { analyzeVolcano } from './src/utils/analysis.js';

// --- CONFIG ---
const INTERVAL = '5m';
const TRADING_FEE = 0.001; // 0.1% binance fee
const TRAILING_PCT = 0.015; // 1.5% as defined in strategy

async function getTop20Symbols() {
    try {
        const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
        const BLACKLIST = ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'AEUR', 'EUR', 'GBP', 'PAXG', 'WBTC', 'USD1', 'USDE', 'SUSD', 'FRAX', 'LUSD', 'GUSD', 'FUSD', 'ZAMA', 'ZEC', 'TROY', 'PUMP', 'ASTER', 'PEPE', 'NEAR', 'U'];

        const relevant = res.data.filter(p => {
            if (!p.symbol.endsWith('USDT')) return false;
            const baseAsset = p.symbol.replace('USDT', '');
            if (BLACKLIST.includes(baseAsset)) return false;
            return parseFloat(p.quoteVolume) > 5000000;
        });

        relevant.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        return relevant.slice(0, 20).map(p => p.symbol);
    } catch (e) {
        console.error('Error fetching symbols:', e.message);
        return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];
    }
}

async function fetchHistoricalKlines(symbol, limit = 500) {
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${INTERVAL}&limit=${limit}`;
        const res = await axios.get(url, { timeout: 10000 });
        return res.data.map(c => ({
            time: c[0],
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5])
        }));
    } catch (e) {
        // console.error(`Error fetching data for ${symbol}:`, e.message);
        return [];
    }
}

async function runBacktest() {
    console.log('🚀 INICIANDO BACKTEST VOLCANO - ÚLTIMAS 24 HORAS...');
    console.log('----------------------------------------------------');

    const symbols = await getTop20Symbols();
    console.log(`📊 Símbolos a analizar: ${symbols.length}`);

    let totalTrades = 0;
    let winningTrades = 0;
    let totalPnlUsd = 0;
    const initialCapital = 60;
    let currentCapital = initialCapital;
    // El usuario quiere el 100% por operación. 
    // Para el backtest, esto significa que operaremos con todo el capital disponible en cada erupción.

    const allRecords = [];

    for (const symbol of symbols) {
        const klines = await fetchHistoricalKlines(symbol, 400); // ~33h of 5m data
        if (klines.length < 50) continue;

        let activeTrade = null;

        // Slide through klines
        for (let i = 50; i < klines.length; i++) {
            const currentCandles = klines.slice(0, i + 1);
            const currentK = klines[i];

            // 1. MONITOR EXIT
            if (activeTrade) {
                const currentPrice = currentK.close;

                // Actualizar Highest Watermark
                if (currentK.high > activeTrade.highestWatermark) {
                    activeTrade.highestWatermark = currentK.high;
                }

                const trailingLine = activeTrade.highestWatermark * (1 - TRAILING_PCT);

                // Exit Condition: Hit trailing AND in profit (user rule)
                if (currentPrice <= trailingLine && currentPrice > activeTrade.entryPrice) {
                    const grossReturn = (currentPrice / activeTrade.entryPrice) * activeTrade.invested;
                    const netReturn = grossReturn * (1 - TRADING_FEE);
                    const pnl = netReturn - activeTrade.invested;

                    totalTrades++;
                    if (pnl > 0) winningTrades++;
                    totalPnlUsd += pnl;
                    currentCapital += (activeTrade.invested + pnl);

                    allRecords.push({
                        symbol,
                        entry: activeTrade.entryPrice,
                        exit: currentPrice,
                        pnlPct: (pnl / activeTrade.invested * 100).toFixed(2),
                        pnlUsd: pnl.toFixed(2),
                        reason: 'TRAILING_EXIT'
                    });

                    activeTrade = null;
                }
                // If forced end
                else if (i === klines.length - 1) {
                    // Still open at end of 24h
                }
            }

            // 2. SCAN ENTRY (Solo si no hay trade activo - 100% Capital)
            if (!activeTrade && currentCapital >= 10) {
                const result = analyzeVolcano({}, currentCandles);
                if (result.prediction.signal === 'STRONG_BUY') {
                    const investedAmount = currentCapital;
                    currentCapital = 0; // Invertimos todo

                    activeTrade = {
                        symbol,
                        entryPrice: currentK.close,
                        invested: investedAmount * (1 - TRADING_FEE),
                        highestWatermark: currentK.close,
                        entryIndex: i
                    };
                }
            }
        }
    }

    console.log(`\n🏆 RESULTADOS FINALES:`);
    console.log(`💰 Capital Inicial: $${initialCapital}`);
    console.log(`📈 Ganancia Neta: $${totalPnlUsd.toFixed(2)} (${(totalPnlUsd / initialCapital * 100).toFixed(2)}%)`);
    console.log(`🤝 Total Trades: ${totalTrades}`);
    console.log(`✅ Ganadores: ${winningTrades} | ❌ Perdedores: ${totalTrades - winningTrades}`);
    console.log(`🎯 Win Rate: ${totalTrades > 0 ? (winningTrades / totalTrades * 100).toFixed(1) : 0}%`);
    console.log('----------------------------------------------------');

    if (allRecords.length > 0) {
        console.log('DETALLE DE OPERACIONES:');
        allRecords.slice(-10).forEach(r => {
            console.log(`- ${r.symbol}: Entrada $${r.entry} -> Salida $${r.exit} | PnL: ${r.pnlPct}% ($${r.pnlUsd})`);
        });
    } else {
        console.log('No se detectaron erupciones en las últimas 24h con los parámetros actuales.');
    }
}

runBacktest();
