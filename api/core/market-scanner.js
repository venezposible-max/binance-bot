import axios from 'axios';
import * as analysis from '../../src/utils/analysis.js';
import binanceClient from '../utils/binance-client.js';
import { v4 as uuidv4 } from 'uuid';
import { sendServerTelegram } from '../utils/telegram-server.js';
import marketWorker from '../stream/market-worker.js';
import redis from '../utils/redisClient.js';

// --- HELPERS (Reused) ---
async function fetchGlobalKlines(symbol, interval, limit = 150) {
    if (marketWorker.activeBan) return null;

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
                marketWorker.setBan(`klines:${src.label}`);

                // Report to Redis (Fire and forget)
                redis.setex('sentinel_rest_banned', 600, 'true').catch(() => { });

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
 * Strategy: SMART DIP — Buy when top coins dip ≥3% + RSI < 35
 * Uses 1H candles for more reliable dip/RSI detection.
 * Sequential loop to enforce trade limits.
 */

export async function scanMarketOpportunities(candidates, mode, walletConfig, marketCache, activeTradesCount = 0, btcVeto = false) {
    const newTrades = [];
    const MAX_TRADES = walletConfig.maxTrades || 3;

    const strategyConfig = walletConfig.strategyConfig?.HYBRID_VORTEX || {};
    const useSmartDip = strategyConfig.useVolcano !== false; // Reuse same toggle

    console.log(`📡 [${mode}] SCANNING ${candidates.length} COINS | STRAT: SMART_DIP`);

    for (const symbol of candidates) {
        if (symbol.includes('PEPE') || symbol.includes('NEAR')) continue;

        if ((activeTradesCount + newTrades.length) >= MAX_TRADES) {
            console.log(`⛔ [${mode}] MAX TRADES REACHED (${activeTradesCount + newTrades.length}/${MAX_TRADES}). Stopping Scan.`);
            break;
        }

        try {
            // --- BLACKLIST CHECK ---
            const isBlacklisted = await redis.get(`sentinel_blacklist:${symbol}`);
            if (isBlacklisted) continue;

            // --- RATE LIMIT PROTECTION ---
            await new Promise(r => setTimeout(r, 150));

            // 1. Get 5m candles (Sincronizado con el Dashboard UI para Match Exacto, 150 velas)
            const candles5m = await fetchGlobalKlines(symbol, '5m', 150);
            if (!candles5m) continue;

            // 2. Run Smart Dip Analysis
            const dipAnalysis = analysis.analyzeSmartDip(null, candles5m);

            if (!useSmartDip) continue;

            // --- EVALUATE SIGNAL ---
            // STRONG_BUY = dip ≥ 3% + RSI < 35 (both confirmed)
            const isSmartDipSignal = dipAnalysis.prediction?.signal === 'STRONG_BUY' && dipAnalysis.prediction.intensity >= 100;

            if (!isSmartDipSignal) continue;

            console.log(`📉 [Smart Dip] ${symbol} SEÑAL DETECTADA | Dip: ${dipAnalysis.indicators.dipPercent}% | RSI: ${dipAnalysis.indicators.rsi}`);

            // 3. Get Price (Real-time from cache or API)
            let currentPrice = marketCache[symbol]?.price;
            if (!currentPrice) {
                try {
                    const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
                    currentPrice = parseFloat(res.data.price);
                } catch (e) { continue; }
            }

            if (!currentPrice) continue;

            // 4. EXECUTE ENTRY
            const risk = walletConfig.riskPercentage || 10;
            const safetyFactor = 0.997;
            const invest = (walletConfig.currentBalance * (risk / 100)) * safetyFactor;
            let qty = invest / currentPrice;
            let realInvest = invest;

            if (mode === 'LIVE') {
                try {
                    const order = await binanceClient.executeOrder(symbol, 'BUY', invest, currentPrice, 'MARKET', true);
                    qty = parseFloat(order.executedQty) || 0;
                    realInvest = parseFloat(order.cummulativeQuoteQty) || invest;
                } catch (err) {
                    console.error(`❌ ENTRY FAILED [${symbol}]:`, err.message);
                    continue;
                }
            }

            // --- SANITIZE ---
            if (qty <= 0) {
                console.error(`❌ EXECUTED QTY IS 0 for ${symbol}. Skipping.`);
                continue;
            }

            let entryPrice = realInvest / qty;
            if (isNaN(entryPrice) || !isFinite(entryPrice)) entryPrice = currentPrice;
            if (isNaN(realInvest) || !isFinite(realInvest)) realInvest = invest;

            const tradeRecord = {
                id: uuidv4(),
                symbol,
                entryPrice: entryPrice,
                investedAmount: realInvest,
                quantity: qty,
                type: 'LONG',
                timestamp: new Date().toISOString(),
                strategy: 'SMART_DIP',
                mode: mode,
                isManual: false,
                stopLoss: null,  // No stop loss — spot, we hold
                takeProfit: null,
                dipPercent: dipAnalysis.indicators.dipPercent,
                rsiAtEntry: dipAnalysis.indicators.rsi
            };

            newTrades.push(tradeRecord);

            console.log(`📉 [${mode}] AUTO-ENTRY: ${symbol} | Strat: SMART_DIP | Dip: ${dipAnalysis.indicators.dipPercent}% | RSI: ${dipAnalysis.indicators.rsi}`);
            await sendServerTelegram(`🤖 <b>[${mode}] AUTO ENTRY</b>\n📉 ${symbol}\n🏷️ SMART DIP\n💧 Dip: ${dipAnalysis.indicators.dipPercent}% | RSI: ${dipAnalysis.indicators.rsi}`);

        } catch (e) {
            // Silent scan errors
        }
    }

    return newTrades;
}

