import axios from 'axios';
import * as analysis from '../../src/utils/analysis.js';
import binanceClient from '../utils/binance-client.js';
import { v4 as uuidv4 } from 'uuid';
import { sendServerTelegram } from '../utils/telegram-server.js';

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
 * Responsibility: Scan candidate pairs, check logic (Vortex/Hybrid), and execute NEW entries.
 * It uses a SEQUENTIAL LOOP to strict enforcement of trade limits (preventing race conditions).
 */

export async function scanMarketOpportunities(candidates, mode, walletConfig, marketCache, activeTradesCount = 0, btcVeto = false) {
    const newTrades = [];
    const activeStrategy = walletConfig.strategy || 'HYBRID_BLITZ';
    const MAX_TRADES = walletConfig.maxTrades || 3;

    // Log intent (Sequential)
    const strategyConfig = walletConfig.strategyConfig?.HYBRID_VORTEX || {};
    const enabledStrats = [];
    if (strategyConfig.useVortex !== false) enabledStrats.push('VORTEX');
    if (strategyConfig.useHybrid !== false) enabledStrats.push('HYBRID');
    if (strategyConfig.useUnixa === true) enabledStrats.push('UNIXA');

    console.log(`📡 [${mode}] SCANNING ${candidates.length} COINS | STRATS: [${enabledStrats.join(' + ')}]`);

    // SEQUENTIAL LOOP (Prevents Race Conditions)
    for (const symbol of candidates) {
        if (symbol.includes('PEPE') || symbol.includes('NEAR')) continue;

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
            const analysisRes = analysis.analyzeVortex(null, candles);

            // 🧬 CONFIG: STRATEGY TOGGLES
            const strategyConfig = walletConfig.strategyConfig?.HYBRID_VORTEX || {};
            const useVortex = strategyConfig.useVortex !== false;
            const useHybrid = strategyConfig.useHybrid !== false;
            const useUnixa = strategyConfig.useUnixa === true; // NEW: UNIXA Logic
            const minOdds = parseFloat(strategyConfig.minOdds || 67);

            // --- EVALUATE SIGNALS ---
            let vortexSignal = false;
            let hybridSignal = false;

            // A. VORTEX (Technical Dip)
            if (useVortex) {
                if (analysisRes.prediction?.signal.includes('BUY') && analysisRes.prediction.intensity > 30) {
                    vortexSignal = true;
                }
            } else { vortexSignal = false; } // Bypass OFF

            // B. HYBRID (Statistical Odds)
            const odds = parseFloat(analysisRes.indicators.hybrid?.odds || 50);
            if (useHybrid) {
                if (odds >= minOdds) {
                    hybridSignal = true;
                }
            } else { hybridSignal = false; } // Bypass OFF

            // C. UNIXA (Extreme RSI < 2)
            let unixaSignal = false;
            let unixaRes = null;
            if (useUnixa) {
                unixaRes = analysis.analyzeUnixa(null, candles);
                if (unixaRes.prediction.signal.includes('BUY')) {
                    unixaSignal = true;
                }
            }

            // --- FINAL DECISION ---
            // Winning Condition: Both Vortex & Hybrid (if active) must agree, OR just the active one
            // We need at least ONE active system to be TRUE
            let standardEntry = false;

            if (useVortex && useHybrid) {
                standardEntry = vortexSignal && hybridSignal && !btcVeto;
            } else if (useVortex && !useHybrid) {
                standardEntry = vortexSignal && !btcVeto;
            } else if (!useVortex && useHybrid) {
                standardEntry = hybridSignal && !btcVeto;
            }

            // UNIXA Condition: Signal matches AND (It bypasses BTC Guard)
            const entryTriggered = standardEntry || unixaSignal;

            if (entryTriggered) {
                // If UNIXA triggered, prioritize its analysis
                const finalAnalysis = unixaSignal ? unixaRes : analysisRes;

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
                // Factor de seguridad (99.7%) para evitar "insufficient balance" por decimales o micro-cambios de precio
                const safetyFactor = 0.997;
                const invest = (walletConfig.currentBalance * (risk / 100)) * safetyFactor;
                let qty = invest / currentPrice;
                let realInvest = invest;

                // Live Execution
                if (mode === 'LIVE') {
                    try {
                        const order = await binanceClient.executeOrder(symbol, 'BUY', invest, currentPrice, 'MARKET', true);
                        qty = parseFloat(order.executedQty) || 0;
                        realInvest = parseFloat(order.cummulativeQuoteQty) || invest;
                    } catch (err) {
                        console.error(`❌ ENTRY FAILED [${symbol}]:`, err.message);
                        continue; // Abort entry, continue loop
                    }
                }

                // --- SANITIZE NUMBERS (CRITICAL for Ghost Trade Prevention) ---
                if (qty <= 0) {
                    console.error(`❌ EXECUTED QTY IS 0 for ${symbol}. Skipping trade record.`);
                    continue;
                }

                let entryPrice = realInvest / qty;
                if (isNaN(entryPrice) || !isFinite(entryPrice)) entryPrice = currentPrice;
                if (isNaN(realInvest) || !isFinite(realInvest)) realInvest = invest;

                // Determine Dynamic Strategy Label
                let strategyLabel = 'UNKNOWN';
                if (unixaSignal) strategyLabel = 'UNIXA';
                else if (useVortex && useHybrid) strategyLabel = 'VORTEX+HYBRID';
                else if (useHybrid) strategyLabel = 'HYBRID';
                else if (useVortex) strategyLabel = 'VORTEX';

                const tradeRecord = {
                    id: uuidv4(),
                    symbol,
                    entryPrice: entryPrice,
                    investedAmount: realInvest,
                    quantity: qty,
                    type: 'LONG',
                    timestamp: new Date().toISOString(),
                    strategy: strategyLabel,
                    mode: mode,
                    isManual: false,
                    stopLoss: finalAnalysis.obZone?.sl || null,
                    takeProfit: finalAnalysis.obZone?.tp || null,
                    odds: odds
                };

                newTrades.push(tradeRecord);

                const emoji = unixaSignal ? '🪐' : '🚀';
                console.log(`${emoji} [${mode}] AUTO-ENTRY: ${symbol} | Strat: ${strategyLabel} | Odds: ${odds.toFixed(1)}%`);
                await sendServerTelegram(`🤖 <b>[${mode}] AUTO ENTRY</b>\n${emoji} ${symbol}\n🏷️ ${strategyLabel}\n🧬 Odds: ${odds.toFixed(1)}%`);
            }

        } catch (e) {
            // console.warn(`Scan Error ${symbol}`, e.message);
        }
    }

    return newTrades;
}
