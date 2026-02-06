
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
 * It ignores existing trades (controlled by validCandidates param).
 */

export async function scanMarketOpportunities(candidates, mode, walletConfig, marketCache) {
    const newTrades = [];
    const activeStrategy = walletConfig.strategy || 'HYBRID_BLITZ';

    // Parallel Scan
    // We cap parallel requests to avoid blasting the API if candidates list is huge
    // But for 10-12 items, Promise.all is fine.

    // Log intent
    console.log(`📡 [${mode}] SCANNING ${candidates.length} COINS: ${candidates.join(', ')}`);

    const promises = candidates.map(async (symbol) => {
        try {
            // 1. Get Candles (150 limit for Odds consistency)
            const candles = await fetchGlobalKlines(symbol, '5m', 150);
            if (!candles) return; // Skip if data fail

            // 2. Run Analysis
            const analysisRes = analysis.analyzeBlitz(null, candles);

            // 3. Filter: Is Technical Signal Valid?
            // "BUY" signal + Intensity > 30 (Filters weak noise)
            if (analysisRes.prediction?.signal.includes('BUY') && analysisRes.prediction.intensity > 30) {

                // 4. Get Price (Real-time)
                // Use cache if available/fresh, else fetch
                let currentPrice = marketCache[symbol]?.price;
                if (!currentPrice) {
                    // Fallback to simpler fetch
                    try {
                        const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
                        currentPrice = parseFloat(res.data.price);
                    } catch (e) { return; }
                }

                if (!currentPrice) return;

                // 5. HYBRID ODDS FILTER 🧬
                // Check user config
                const strategyConfig = walletConfig.strategyConfig?.HYBRID_BLITZ || {};
                const useHybrid = strategyConfig.useHybrid !== false; // Default ON
                const minOdds = parseFloat(strategyConfig.minOdds || 67); // Default 67%

                const odds = parseFloat(analysisRes.indicators.hybrid?.odds || 50);

                if (useHybrid && odds < minOdds) {
                    console.log(`[${mode}] 🧬 HYBRID PROTECT: Skipping ${symbol} (Odds: ${odds.toFixed(1)}% < ${minOdds}%)`);
                    return; // SKIP
                }

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
                        return; // Abort entry
                    }
                } else {
                    // Sim Logic
                    // We modify the wallet balance later in the orchestrator to avoid race conditions here?
                    // Actually, cleaner to return the "Cost" and let orchestrator deduct.
                    // But for now, we attach the cost to the trade object.
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
                    odds: odds // Record the odds for history
                };

                newTrades.push(tradeRecord);

                console.log(`🚀 [${mode}] AUTO-ENTRY: ${symbol} (Odds: ${odds.toFixed(1)}%)`);
                await sendRawTelegram(`🤖 **[${mode}] AUTO ENTRY**\n🚀 ${symbol}\n🧬 Odds: ${odds.toFixed(1)}%`);
            }

        } catch (e) {
            // calculated silence or low log
            // console.warn(`Scan Error ${symbol}`, e.message);
        }
    });

    await Promise.all(promises);

    return newTrades;
}
