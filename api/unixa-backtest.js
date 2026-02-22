import axios from 'axios';
import { RSI, ATR } from 'technicalindicators';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'LINKUSDT', 'WIFUSDT', 'SUIUSDT', 'FETUSDT', 'AVAXUSDT'];
const INTERVAL = '5m';
const CONF = { rsiIn: 2.0, tpAtr: 2.0, euforia: 95, timeoutVelas: 288 };

async function fetchHistoricalKlines(symbol, limit) {
    let allKlines = [];
    let endTime = Date.now();
    try {
        // Binance limit is 1000 per request. For 1w/1m we might need more but 1000 candles of 5m is ~3.5 days.
        // For 1w at 5m = 2016 candles. We'll simplify to 1000 for now to avoid pagination complexity 
        // OR we just use 15m/1h for longer periods. 
        // Let's stick to 5m and use max 1000 candles (~3.4 days) if interval is 5m.
        // Actually, let's keep it simple: 24h=288, 48h=576, 1w=2016, 1m=8640.
        // We will cap at 1000 for 5m to avoid rate limits/timeouts unless we change interval.
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${INTERVAL}&limit=${limit}&endTime=${endTime}`;
        const res = await axios.get(url);
        allKlines = res.data;
    } catch (e) {
        console.error(`Error fetching data for ${symbol}:`, e.message);
    }
    return allKlines;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    try {
        const payload = req.body;
        const initialCapital = parseFloat(payload.capital || 1000);
        const riskPercentage = parseFloat(payload.risk || 10);
        const maxTrades = parseInt(payload.maxTrades || 3);
        const range = payload.range || '24h';

        // Calculate candles needed (exact multiples for real-world consistency)
        let limit = 288; // 24h
        if (range === '48h') limit = 576;

        let currentCapital = initialCapital;
        let activeTradesCount = 0;
        let activeTradesMap = {}; // { SYMBOL: { entryPrice, tp, entryIndex, sizeUsd, quantity } }
        let tradeHistory = [];

        // 1. Fetch data for all coins
        const cache = {};
        let minDataLength = 9999;
        for (const sym of SYMBOLS) {
            cache[sym] = await fetchHistoricalKlines(sym, limit + 20); // extra for indicators
            if (cache[sym].length < minDataLength) minDataLength = cache[sym].length;
        }

        const totalSteps = minDataLength;
        const offset = 20;

        // Precompute RSI and ATR for all
        const indicatorsCache = {};
        for (const sym of SYMBOLS) {
            const data = cache[sym];
            if (data.length < 50) continue;
            const closes = data.map(d => parseFloat(d[4]));
            const highs = data.map(d => parseFloat(d[2]));
            const lows = data.map(d => parseFloat(d[3]));

            const rsiArr = RSI.calculate({ period: 2, values: closes });
            const atrArr = ATR.calculate({ period: 10, high: highs, low: lows, close: closes });

            const rsiPadded = new Array(closes.length - rsiArr.length).fill(50).concat(rsiArr);
            const atrPadded = new Array(closes.length - atrArr.length).fill(0).concat(atrArr);

            indicatorsCache[sym] = { closes, highs, lows, rsi: rsiPadded, atr: atrPadded };
        }

        const fee = 0.002;

        for (let i = offset; i < totalSteps; i++) {
            // First loop: Check Exits
            for (const sym in activeTradesMap) {
                const trade = activeTradesMap[sym];
                const ind = indicatorsCache[sym];
                if (!ind || i >= ind.closes.length) continue;

                const currentPrice = ind.closes[i];
                const currentHigh = ind.highs[i];
                const currentRsi = ind.rsi[i];

                let exitReason = null;
                let exitPrice = 0;

                if (currentHigh >= trade.tp) {
                    exitPrice = trade.tp;
                    exitReason = "TP Natural (ATR 2x)";
                } else if (i === totalSteps - 1) {
                    exitPrice = currentPrice;
                    exitReason = "Cierre Forzado (Fin Periodo)";
                }

                if (exitReason) {
                    const grossValue = trade.quantity * exitPrice;
                    const netValue = grossValue * (1 - (fee / 2)); // exit fee
                    const pnlUsd = netValue - trade.sizeUsd;
                    const pnlPct = (pnlUsd / trade.sizeUsd) * 100;

                    currentCapital += grossValue * (1 - (fee / 2)); // Add full value back to liquid pool
                    tradeHistory.push({
                        symbol: sym,
                        entryPrice: trade.entryPrice,
                        exitPrice,
                        pnlPct,
                        pnlUsd,
                        reason: exitReason,
                        durationMins: (i - trade.entryIndex) * 5
                    });

                    delete activeTradesMap[sym];
                    activeTradesCount--;
                }
            }

            // Second loop: Check Entries
            for (const sym of SYMBOLS) {
                const ind = indicatorsCache[sym];
                if (!ind || i >= ind.closes.length) continue;

                if (activeTradesCount < maxTrades && !activeTradesMap[sym]) {
                    const currentPrice = ind.closes[i];
                    const currentRsi = ind.rsi[i];

                    if (currentRsi < CONF.rsiIn) {
                        const sizeUsd = currentCapital * (riskPercentage / 100);
                        const sizeAfterFee = sizeUsd * (1 - (fee / 2));

                        currentCapital -= sizeUsd; // Reserve capital from pool
                        const quantity = sizeAfterFee / currentPrice;

                        let tp = currentPrice + (ind.atr[i] * CONF.tpAtr);
                        tp = Math.max(tp, currentPrice * 1.004); // 0.4% floor

                        activeTradesMap[sym] = {
                            entryPrice: currentPrice,
                            tp,
                            entryIndex: i,
                            sizeUsd,
                            quantity
                        };
                        activeTradesCount++;
                    }
                }
            }
        }

        const netProfitUsd = currentCapital - initialCapital;
        const netProfitPct = (netProfitUsd / initialCapital) * 100;
        const wins = tradeHistory.filter(t => t.pnlPct > 0).length;

        // Add still open trades safely back to equity
        let equity = currentCapital;
        for (const sym in activeTradesMap) {
            const tr = activeTradesMap[sym];
            const currentPrice = indicatorsCache[sym].closes[totalSteps - 1] || tr.entryPrice;
            const value = tr.quantity * currentPrice * (1 - fee / 2);
            equity += value;
        }

        res.status(200).json({
            initialCapital,
            finalEquity: equity,
            netProfitUsd: equity - initialCapital,
            netProfitPct: ((equity - initialCapital) / initialCapital) * 100,
            totalTrades: tradeHistory.length,
            winRate: tradeHistory.length > 0 ? (wins / tradeHistory.length) * 100 : 0,
            wins,
            losses: tradeHistory.length - wins,
            trades: tradeHistory.reverse() // Newest first
        });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}
