
import axios from 'axios';
import * as analysis from '../../src/utils/analysis.js';
import binanceClient from '../utils/binance-client.js';
import { v4 as uuidv4 } from 'uuid';
import { sendRawTelegram } from '../../src/utils/telegram.js';

// --- HELPERS (Reused) ---
async function fetchGlobalKlines(symbol, interval, limit = 150) {
    const sources = [
        { url: `https://api-gcp.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, label: 'EU_GCP' },
        { url: `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, label: 'GLOBAL' }
    ];
    for (const src of sources) {
        try {
            const res = await axios.get(src.url, { timeout: 5000 });
            if (res.data && Array.isArray(res.data)) { return res.data; }
        } catch (e) { if (!e.response || e.response.status !== 403) break; }
    }
    return null;
}

/**
 * CORE MODULE: MARKET SCANNER
 * Responsibility: Scan candidate pairs, check logic (Blitz/Hybrid), and execute NEW entries.
 * It uses a SEQUENTIAL LOOP to strict enforcement of trade limits (preventing race conditions).
 */

export async function scanMarketOpportunities(candidates, mode, walletConfig, marketCache, activeTradesCount = 0) {
    const newTrades = [];
    const activeStrategy = walletConfig.strategy || 'HYBRID_BLITZ';
    const MAX_TRADES = walletConfig.maxTrades || 3;

    // Log intent (Sequential)
    console.log(`📡 [${mode}] SCANNING ${candidates.length} COINS via SEQUENTIAL LOOP`);

    // SEQUENTIAL LOOP (Prevents Race Conditions)
    for (const symbol of candidates) {

        // 🛑 CRITICAL LIMIT CHECK
        // We check this at the START of every iteration.
        // If we already filled the bag, we STOP immediately.
        if ((activeTradesCount + newTrades.length) >= MAX_TRADES) {
            console.log(`⛔ [${mode}] MAX TRADES REACHED (${activeTradesCount + newTrades.length}/${MAX_TRADES}). Stopping Scan.`);
            break;
        }

        try {
            // 1. Get Candles (150 limit)
            const candles = await fetchGlobalKlines(symbol, '5m', 150);
            if (!candles) continue; // Skip to next iteration

            // 2. Run Analysis
            const analysisRes = analysis.analyzeBlitz(null, candles);

            // 🧬 CONFIG: STRATEGY TOGGLES
            const strategyConfig = walletConfig.strategyConfig?.HYBRID_BLITZ || {};
            // Default to TRUE if undefined to maintain backward compatibility
            const useBlitz = strategyConfig.useBlitz !== false;
            const useHybrid = strategyConfig.useHybrid !== false;
            const minOdds = parseFloat(strategyConfig.minOdds || 67);

            // --- EVALUATE SIGNALS ---
            let blitzSignal = false;
            let hybridSignal = false;

            // A. BLITZ (Technical Dip)
            if (useBlitz) {
                if (analysisRes.prediction?.signal.includes('BUY') && analysisRes.prediction.intensity > 30) {
                    blitzSignal = true;
                }
            } else { blitzSignal = true; } // Bypass if OFF

            // B. HYBRID (Statistical Odds)
            const odds = parseFloat(analysisRes.indicators.hybrid?.odds || 50);
            if (useHybrid) {
                if (odds >= minOdds) {
                    hybridSignal = true;
                } else {
                    console.log(`[${mode}] 🧬 HYBRID SKIP ${symbol} (${odds.toFixed(1)}% < ${minOdds}%)`);
                }
            } else { hybridSignal = true; } // Bypass if OFF

            // --- FINAL DECISION ---
            // Safety: If BOTH are OFF, do nothing.
            const bothOff = !useBlitz && !useHybrid;

            if (!bothOff && blitzSignal && hybridSignal) {

                // 4. Get Price (Real-time)
                let currentPrice = marketCache[symbol]?.price;
                if (!currentPrice) {
                    try {
                        const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
                        currentPrice = parseFloat(res.data.price);
                    } catch (e) { continue; }
                }

                if (!currentPrice) continue;

                // 6. EXECUTE ENTRY
                const risk = walletConfig.riskPercentage || 10;
                const invest = walletConfig.currentBalance * (risk / 100);
                let qty = invest / currentPrice;
                let realInvest = invest;

                // Live Execution
                if (mode === 'LIVE') {
                    try {
                        const order = await binanceClient.executeOrder(symbol, 'BUY', invest, currentPrice, 'MARKET', true);
                        qty = parseFloat(order.executedQty);
                        realInvest = parseFloat(order.cummulativeQuoteQty);
                    } catch (err) {
                        console.error(`❌ ENTRY FAILED [${symbol}]:`, err.message);
                        continue; // Abort entry, continue loop
                    }
                }

                const tradeRecord = {
                    id: uuidv4(),
                    symbol,
                    entryPrice: realInvest / qty,
                    investedAmount: realInvest,
                    quantity: qty,
                    type: 'LONG',
                    timestamp: new Date().toISOString(),
                    strategy: 'BLITZ',
                    mode: mode,
                    isManual: false,
                    stopLoss: analysisRes.obZone?.sl || null,
                    takeProfit: analysisRes.obZone?.tp || null,
                    odds: odds
                };

                newTrades.push(tradeRecord);

                console.log(`🚀 [${mode}] AUTO-ENTRY: ${symbol} (Odds: ${odds.toFixed(1)}%)`);
                await sendRawTelegram(`🤖 **[${mode}] AUTO ENTRY**\n🚀 ${symbol}\n🧬 Odds: ${odds.toFixed(1)}%`);
            }

        } catch (e) {
            // console.warn(`Scan Error ${symbol}`, e.message);
        }
    }

    return newTrades;
}
