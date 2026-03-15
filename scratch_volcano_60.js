import axios from 'axios';
import { analyzeVolcano } from './src/utils/analysis.js';

// --- CONFIG ---
const INTERVAL = '5m';
const TRADING_FEE = 0.001;
const TRAILING_PCT = 0.015;

async function getTop20Symbols() {
    try {
        const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
        const BLACKLIST = ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'AEUR', 'EUR', 'GBP', 'PAXG', 'WBTC', 'USD1', 'USDE', 'SUSD', 'FRAX', 'LUSD', 'GUSD', 'FUSD', 'ZAMA', 'ZEC', 'TROY', 'PUMP', 'PEPE', 'NEAR', 'U'];

        const relevant = res.data.filter(p => {
            if (!p.symbol.endsWith('USDT')) return false;
            const baseAsset = p.symbol.replace('USDT', '');
            if (BLACKLIST.includes(baseAsset)) return false;
            return parseFloat(p.quoteVolume) > 2000000; // Lower volume limit for backtest sensitivity
        });

        relevant.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        return relevant.slice(0, 50).map(p => p.symbol);
    } catch (e) {
        return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];
    }
}

async function fetchHistoricalKlines(symbol, limit = 500) {
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${INTERVAL}&limit=${limit}`;
        const res = await axios.get(url, { timeout: 10000 });
        return res.data;
    } catch (e) {
        return [];
    }
}

async function runBacktest() {
    console.log('🚀 INICIANDO BACKTEST VOLCANO (CAPITAL $60 - 1 SEMANA - 100% REINVERSIÓN)');
    console.log('----------------------------------------------------');

    const symbols = await getTop20Symbols();

    // Load all data into a timeline to simulate real sequential time
    const timeline = [];
    for (const symbol of symbols) {
        process.stdout.write(`⏳ Cargando datos de ${symbol}... \r`);
        const data = await fetchHistoricalKlines(symbol, 2016); // 1 semana (2016 velas de 5m)
        if (data.length < 50) continue;
        data.forEach((d, idx) => {
            timeline.push({
                time: d[0],
                symbol: symbol,
                high: parseFloat(d[2]),
                low: parseFloat(d[3]),
                close: parseFloat(d[4]),
                volume: parseFloat(d[5]),
                raw: data.slice(0, idx + 1)
            });
        });
    }
    console.log('\n✅ Datos cargados. Procesando cronología...');


    // Sort timeline by time
    timeline.sort((a, b) => a.time - b.time);

    let currentCapital = 60;
    const initialCapital = 60;
    let activeTrade = null;
    const history = [];

    // Process timeline
    for (const step of timeline) {
        // 1. Check Exit
        if (activeTrade && activeTrade.symbol === step.symbol) {
            if (step.high > activeTrade.highestWatermark) {
                activeTrade.highestWatermark = step.high;
            }

            const trailingLine = activeTrade.highestWatermark * (1 - TRAILING_PCT);
            if (step.close <= trailingLine && step.close > activeTrade.entryPrice) {
                // EXIT!
                const gross = (step.close / activeTrade.entryPrice) * activeTrade.invested;
                const net = gross * (1 - TRADING_FEE);
                const pnlUsd = net - activeTrade.invested;
                currentCapital += net;

                history.push({
                    symbol: step.symbol,
                    pnlPct: (pnlUsd / activeTrade.invested * 100).toFixed(2),
                    pnlUsd: pnlUsd.toFixed(2),
                    entry: activeTrade.entryPrice,
                    exit: step.close
                });
                activeTrade = null;
            }
        }

        // 2. Check Entry
        if (!activeTrade && currentCapital >= 10) {
            // Map raw to standard candle objects for analyzeVolcano
            const candles = step.raw.map(c => ({
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
                volume: parseFloat(c[5])
            }));

            const result = analyzeVolcano({}, candles);
            if (result.prediction.signal === 'STRONG_BUY') {
                activeTrade = {
                    symbol: step.symbol,
                    entryPrice: step.close,
                    invested: currentCapital * (1 - TRADING_FEE),
                    highestWatermark: step.close
                };
                currentCapital = 0;
            }
        }
    }

    // Final result
    const finalEquity = currentCapital + (activeTrade ? activeTrade.invested : 0);
    const winRate = history.length > 0 ? (history.filter(h => h.pnlUsd > 0).length / history.length * 100).toFixed(1) : 0;

    console.log(`🏆 RESULTADOS FINALES:`);
    console.log(`💰 Capital Inicial: $${initialCapital}`);
    console.log(`📈 Balance Final: $${finalEquity.toFixed(2)} (${((finalEquity - initialCapital) / initialCapital * 100).toFixed(2)}%)`);
    console.log(`🤝 Total Trades: ${history.length}`);
    console.log(`🎯 Win Rate: ${winRate}%`);
    console.log('----------------------------------------------------');
    history.forEach(h => {
        console.log(`- ${h.symbol}: ${h.pnlPct}% (+$${h.pnlUsd})`);
    });
}

runBacktest();
