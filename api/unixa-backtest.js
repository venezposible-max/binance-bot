import axios from 'axios';
import { RSI, ATR } from 'technicalindicators';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'PEPEUSDT', 'WIFUSDT', 'SUIUSDT', 'FETUSDT', 'AVAXUSDT'];
const INTERVAL = '5m';
const CONF = { rsiIn: 2.0, tpAtr: 2.0, euforia: 95, timeoutVelas: 288 };

async function fetch24hKlines(symbol) {
    let allKlines = [];
    let endTime = Date.now();
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${INTERVAL}&limit=350&endTime=${endTime}`;
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

        let currentCapital = initialCapital;
        let activeTradesCount = 0;
        let activeTradesMap = {}; // { SYMBOL: { entryPrice, tp, entryIndex, sizeUsd, quantity } }
        let tradeHistory = [];

        // 1. Fetch data for all coins
        const cache = {};
        for (const sym of SYMBOLS) {
            cache[sym] = await fetch24hKlines(sym);
        }

        // 2. We align them by timestamp if needed, but since they are 350 exact candles ending NOW, 
        // we can assume index 'i' corresponds to the same 5-minute window for all coins.
        // Let's iterate index by index.
        const totalSteps = 350;
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
                } else if (currentRsi >= CONF.euforia) {
                    exitPrice = currentPrice;
                    exitReason = "Euforia (RSI 95)";
                } else if (i - trade.entryIndex >= CONF.timeoutVelas) {
                    exitPrice = currentPrice;
                    exitReason = "Timeout 24H";
                } else if (i === totalSteps - 1) {
                    exitPrice = currentPrice;
                    exitReason = "Cierre Forzado";
                }

                if (exitReason) {
                    const grossValue = trade.quantity * exitPrice;
                    const netValue = grossValue * (1 - (fee / 2)); // exit fee
                    const pnlUsd = netValue - trade.sizeUsd;
                    const pnlPct = (pnlUsd / trade.sizeUsd) * 100;

                    currentCapital += pnlUsd;
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
                        const sizeAfterFee = sizeUsd * (1 - (fee / 2)); // entry fee
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
