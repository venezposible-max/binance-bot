import axios from 'axios';
import * as analysis from '../../src/utils/analysis.js';
import binanceClient from '../utils/binance-client.js';
import { v4 as uuidv4 } from 'uuid';
import { sendServerTelegram } from '../utils/telegram-server.js';
import marketWorker from '../stream/market-worker.js';
import redis from '../utils/redisClient.js';

// --- BAN MANAGEMENT ---
let isRestBanned = false;
let banExpiration = 0;

function checkBan() {
    if (isRestBanned) {
        if (Date.now() > banExpiration) {
            console.log('🔄 [REST BAN] Cooldown finished. Attempting to resume...');
            isRestBanned = false;
            marketWorker.isBanned = false;
            return false;
        }
        return true;
    }
    return marketWorker.isBanned;
}

// --- HELPERS (Reused) ---
async function fetchGlobalKlines(symbol, interval, limit = 150) {
    if (checkBan()) return null;

    const sources = [
        { url: `https://api-gcp.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, label: 'EU_GCP' },
        { url: `https://api1.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, label: 'API1' },
        { url: `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, label: 'GLOBAL' }
    ];

    for (const src of sources) {
        try {
            const res = await axios.get(src.url, { timeout: 4000 });
            if (res.data && Array.isArray(res.data)) { return res.data; }
        } catch (e) {
            const status = e.response?.status;
            if (status === 418 || status === 429) {
                console.error(`🚨 [REST BAN] detected on ${src.label}. Status: ${status}. Cooling down for 10 mins.`);
                isRestBanned = true;
                banExpiration = Date.now() + 600000; // 10 minutes
                marketWorker.isBanned = true;
                marketWorker.banExpiration = banExpiration;

                // Report to Redis (Fire and forget)
                import('../utils/redisClient.js').then(r => {
                    r.default.setex('sentinel_rest_banned', 600, 'true');
                }).catch(() => { });

                return null;
            }
            // If it's just a timeout or other error, try next mirror
            continue;
        }
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
    if (strategyConfig.useVolcano !== false) enabledStrats.push('VOLCANO');

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
            // --- BLACKLIST CHECK (Mejora 6) ---
            const isBlacklisted = await redis.get(`sentinel_blacklist:${symbol}`);
            if (isBlacklisted) {
                // console.log(`⏭️ [${mode}] Skipping ${symbol} (Blacklisted)`);
                continue;
            }

            // --- RATE LIMIT PROTECTION (Anti-Ban) ---
            await new Promise(r => setTimeout(r, 150)); 

            // 1. Get Candles (5m first - Mejora 4 Optimizada)
            const candles5m = await fetchGlobalKlines(symbol, '5m', 100);
            if (!candles5m) continue; 

            // 2. Run Analysis 5m (Volcano)
            const analysis5m = analysis.analyzeVolcano(null, candles5m);
            
            // 🧬 CONFIG: STRATEGY TOGGLES
            const strategyConfig = walletConfig.strategyConfig?.HYBRID_VORTEX || {};
            const useVolcano = strategyConfig.useVolcano !== false;

            // --- EVALUATE SIGNALS ---
            let volcanoSignal = false;

            if (useVolcano) {
                const triggered5m = analysis5m.prediction?.signal.includes('BUY') && analysis5m.prediction.intensity > 80;
                
                if (triggered5m) {
                    // Solo consultamos 15m si el 5m ya explotó (Ahorro de API Weight)
                    const candles15m = await fetchGlobalKlines(symbol, '15m', 100);
                    if (candles15m) {
                        const analysis15m = analysis.analyzeVolcano(null, candles15m);

                        // CONFIRMACIÓN: En 15m solo necesitamos que esté al menos "DORMIDA" (Intensidad >= 20)
                        // No esperamos a que explote el 15m también, porque para ese entonces ya se fue el tren.
                        const triggered15m = (analysis15m.prediction?.intensity >= 20);

                        if (triggered15m) {
                            volcanoSignal = true;
                            console.log(`🎯 [Dual TF] ${symbol} Confirmado (5m 🌋 + 15m 💤)`);
                        } else {
                            // console.log(`⏭️ [Dual TF] ${symbol} Rechazado (5m 🌋 pero 15m no estaba dormida)`);
                        }
                    }
                }
            }

            // --- FINAL DECISION ---
            const entryTriggered = (useVolcano && volcanoSignal && !btcVeto);

            if (entryTriggered) {
                const finalAnalysis = analysis5m;

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
                let strategyLabel = 'VOLCANO';

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
                    stopLoss: null, // Volcano starts without Stop Loss per user request
                    takeProfit: null
                };

                newTrades.push(tradeRecord);

                const emoji = '🌋';
                console.log(`${emoji} [${mode}] AUTO-ENTRY: ${symbol} | Strat: ${strategyLabel} | Vol: ${finalAnalysis.indicators.volumeRatio}x`);
                await sendServerTelegram(`🤖 <b>[${mode}] AUTO ENTRY</b>\n${emoji} ${symbol}\n🏷️ ${strategyLabel}\n📈 Compresión Rota: ${finalAnalysis.indicators.volatility}%`);
            }

        } catch (e) {
            // console.warn(`Scan Error ${symbol}`, e.message);
        }
    }

    return newTrades;
}
