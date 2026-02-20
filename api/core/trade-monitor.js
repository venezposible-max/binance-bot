
import binanceClient from '../utils/binance-client.js';
import { sendServerTelegram } from '../utils/telegram-server.js';
import axios from 'axios';
import { RSI } from 'technicalindicators';

/**
 * CORE MODULE: TRADE MONITOR
 * Responsibility: Watch active trades, update Stop Loss (Trailing), and execute Exits.
 * It does NOT scan for new trades. It protects existing capital.
 */

export async function monitorActiveTrades(activeTrades, marketCache, mode, walletConfig) {
    const results = [];
    const updates = [];
    const history = [];

    // Parallel Monitoring
    const promises = activeTrades.map(async (trade) => {
        try {
            const symbol = trade.symbol;

            // 1. Auto Clean Invalid Trades (Sanitation)
            if (!/^[A-Z0-9]+$/.test(symbol) || symbol.includes('ZAMA')) {
                history.push({ ...trade, pnl: 0, profitUsd: 0, strategy: 'PURGE_INVALID', timestamp: new Date().toISOString() });
                return; // Remove from active
            }

            // 2. Get Current Price
            // We expect marketCache to be pre-filled by the orchestrator (check-prices)
            // If missing, we skip this cycle (safety buffer) rather than crash
            const marketData = marketCache[symbol];
            if (!marketData || !marketData.price) {
                updates.push(trade); // Keep blindly
                return;
            }

            const currentPrice = marketData.price;
            let currentBid = marketData.bid || currentPrice;
            let currentAsk = marketData.ask || currentPrice;

            // 3. Calculate PnL
            let pnl = 0;
            if (trade.type === 'SHORT') {
                pnl = ((trade.entryPrice - currentAsk) / trade.entryPrice) * 100;
            } else {
                pnl = ((currentBid - trade.entryPrice) / trade.entryPrice) * 100;
            }

            // 4. TRAILING STOP LOGIC
            // Only runs in memory for this cycle until saved
            let updatedTrade = { ...trade };
            let isExit = false;
            let exitReason = '';

            // ⛔ BYPASS TRAILING STOP FOR UNIXA (It holds for natural Target or Timeout)
            if (trade.strategy !== 'UNIXA') {
                // 🩹 SELF-HEALING: Fix Zombie Trades (Trailing but no SL)
                if (trade.isTrailing && (!trade.stopLoss || trade.stopLoss <= 0)) {
                    // If we lost the SL value but flag is true, restore it safely below current price
                    const healMargin = 0.005; // 0.5% buffer
                    if (trade.type === 'SHORT') updatedTrade.stopLoss = currentPrice * (1 + healMargin);
                    else updatedTrade.stopLoss = currentPrice * (1 - healMargin);
                    console.log(`[${mode}] 🩹 HEALING ${symbol}: Restored missing TS to ${updatedTrade.stopLoss.toFixed(4)}`);
                }

                // Dynamic Trailing: Activates after +0.7% profit
                if (pnl >= 0.7) {
                    const trailMargin = 0.002; // 0.2% distance
                    let newTrailingSL = 0;
                    let trailingTriggered = false;

                    if (trade.type === 'SHORT') {
                        newTrailingSL = currentPrice * (1 + trailMargin);
                        // Move SL down (tighten)
                        if (!trade.stopLoss || newTrailingSL < trade.stopLoss) {
                            updatedTrade.stopLoss = newTrailingSL;
                            trailingTriggered = true;
                        }
                    } else {
                        newTrailingSL = currentPrice * (1 - trailMargin);
                        // Move SL up (tighten)
                        if (!trade.stopLoss || newTrailingSL > trade.stopLoss) {
                            updatedTrade.stopLoss = newTrailingSL;
                            trailingTriggered = true;
                        }
                    }

                    if (trailingTriggered || trade.isTrailing) {
                        updatedTrade.isTrailing = true;
                        if (trailingTriggered) {
                            console.log(`[${mode}] ⛓️ TRAILING STOP UPDATED: ${symbol} @ +${pnl.toFixed(2)}% | New SL: ${newTrailingSL}`);
                        }
                    }
                }
            } // END OF IF NOT UNIXA

            // 5. EXIT CONDITIONS CHECK
            const hasSpecificSL = updatedTrade.stopLoss !== null && updatedTrade.stopLoss !== undefined;
            const globalTP = walletConfig.takeProfit || 1.5;

            // Priority: Trade TP > Global Config TP
            let finalTPPerc = globalTP;
            if (trade.takeProfit) {
                // Convert price-based TP to percentage logic if stored as price, 
                // OR if stored as absolute price, check price directly.
                // Currently VORTEX stores Absolute Price in 'takeProfit'.

                // Absolute Price Check
                if (trade.type === 'LONG' && currentPrice >= trade.takeProfit) { isExit = true; exitReason = 'TP_HIT'; }
                if (trade.type === 'SHORT' && currentPrice <= trade.takeProfit) { isExit = true; exitReason = 'TP_HIT'; }
            } else {
                // Percentage fallback
                if (pnl >= finalTPPerc) { isExit = true; exitReason = 'GLOBAL_TP_HIT'; }
            }

            // Stop Loss Check (Only if NOT UNIXA)
            if (hasSpecificSL && trade.strategy !== 'UNIXA') {
                if (trade.type === 'LONG' && currentPrice <= updatedTrade.stopLoss) { isExit = true; exitReason = 'SL_HIT'; }
                else if (trade.type === 'SHORT' && currentPrice >= updatedTrade.stopLoss) { isExit = true; exitReason = 'SL_HIT'; }
            }

            // ⚠️ UNIXA EXCLUSIVE RULES
            if (trade.strategy === 'UNIXA' && !isExit) {
                // RULE 1: TIME OUT (48 hours = 172800000 ms)
                const tradeTimeMs = new Date(trade.timestamp).getTime();
                const nowMs = Date.now();
                if ((nowMs - tradeTimeMs) > 172800000) {
                    isExit = true;
                    exitReason = 'UNIXA_TIMEOUT_48H';
                }

                // RULE 2: EUPHORIA (RSI(2) > 80)
                if (!isExit) {
                    try {
                        const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=15`, { timeout: 3000 });
                        if (res.data && Array.isArray(res.data)) {
                            const closes = res.data.map(d => parseFloat(d[4]));
                            const rsiArr = RSI.calculate({ values: closes, period: 2 });
                            const currentRsi = rsiArr[rsiArr.length - 1];
                            if (currentRsi >= 80) {
                                isExit = true;
                                exitReason = `UNIXA_EUPHORIA_RSI_${currentRsi.toFixed(0)}`;
                            }
                        }
                    } catch (e) {
                        // Silent fail, just fallback to TP or Timeout on next cycle
                    }
                }
            }

            // 6. EXECUTE EXIT
            if (isExit) {
                console.log(`[${mode}] 📉 CLOSING POSITION: ${symbol} (${exitReason}) PnL: ${pnl.toFixed(2)}%`);

                const qty = trade.quantity || (trade.investedAmount / (trade.entryPrice || 1));
                let netProfit = 0, finalPercent = 0, executionPrice = currentPrice;

                if (mode === 'LIVE') {
                    try {
                        // 🧴 BALANCE SYNC: Fetch real wallet balance before selling to avoid commission gaps
                        let finalQty = qty;
                        const asset = symbol.replace('USDT', '');
                        const balance = await binanceClient.getAccountBalance(asset);

                        if (balance && !balance.error && balance.available > 0) {
                            // If wallet has less than expected, use wallet balance (prevents -2010 error)
                            if (balance.available < qty) {
                                console.warn(`⚖️ BALANCE GAP detected for ${symbol}: Bot expected ${qty}, Wallet has ${balance.available}. Using wallet balance.`);
                                finalQty = balance.available;
                            }
                        }

                        const order = await binanceClient.executeOrder(symbol, 'SELL', finalQty, currentPrice, 'MARKET', true);
                        const received = parseFloat(order.cummulativeQuoteQty) || 0;
                        const executed = parseFloat(order.executedQty) || 0;
                        const fee = received * 0.001; // Approx fee

                        netProfit = received - (trade.investedAmount || 0) - (trade.entryFee || 0) - fee;
                        finalPercent = trade.investedAmount > 0 ? (netProfit / trade.investedAmount) * 100 : 0;
                        executionPrice = executed > 0 ? (received / executed) : currentPrice;
                    } catch (err) {
                        const apiMsg = err.response?.data?.msg || err.message || "Unknown error";
                        console.error(`❌ LIVE EXIT FAILED for ${symbol}:`, apiMsg);

                        // Emergency fallback: If error is strictly about balance/filters/dust (2010 = Insufficient Balance)
                        // we must force close locally to prevent "Ghost Trades" looping.
                        const lowerMsg = apiMsg.toLowerCase();
                        if (lowerMsg.includes('lot_size') ||
                            lowerMsg.includes('insufficient') ||
                            lowerMsg.includes('min_notional') ||
                            lowerMsg.includes('filter') ||
                            (err.response?.data?.code === -2010)) {

                            console.warn(`🛡️ FORCE CLOSING GHOST/DUST TRADE: ${symbol} (Reason: ${apiMsg})`);
                            netProfit = 0; finalPercent = 0; executionPrice = currentPrice;
                        } else {
                            // Network error or other? Keep trade active to retry next cycle
                            updates.push(updatedTrade);
                            return;
                        }
                    }
                } else {
                    // SIMULATION MATH
                    const simQty = trade.quantity || (trade.investedAmount / (trade.entryPrice || 1));
                    const entryFee = (trade.investedAmount || 0) * 0.001;
                    const exitFee = (currentPrice * simQty) * 0.001;
                    const totalFee = entryFee + exitFee;

                    let grossProfit = 0;
                    if (trade.type === 'SHORT') {
                        grossProfit = ((trade.entryPrice || 0) - currentPrice) * simQty;
                    } else {
                        grossProfit = (currentPrice - (trade.entryPrice || 0)) * simQty;
                    }

                    netProfit = grossProfit - totalFee;
                    finalPercent = trade.investedAmount > 0 ? (netProfit / trade.investedAmount) * 100 : 0;
                    executionPrice = currentPrice;
                }

                // --- SANITIZE NUMBERS (Prevents JSON null/NaN corruption) ---
                if (isNaN(netProfit) || !isFinite(netProfit)) netProfit = 0;
                if (isNaN(finalPercent) || !isFinite(finalPercent)) finalPercent = 0;
                if (isNaN(executionPrice) || !isFinite(executionPrice)) executionPrice = currentPrice;

                // Create Win Record
                const winRecord = {
                    ...trade,
                    pnl: finalPercent,
                    profitUsd: netProfit,
                    timestamp: new Date().toISOString(), // Exit Time
                    entryTimestamp: trade.entryTimestamp || trade.timestamp,
                    exitPrice: executionPrice,
                    exitReason: exitReason
                };

                // Notification - USING SERVER DIRECT SEND
                const emoji = netProfit >= 0 ? '🟢' : '🔴';
                await sendServerTelegram(`🚨 <b>[${mode}] AUTO CLOSE: ${symbol}</b>\n${emoji} ROI: ${finalPercent.toFixed(2)}%\n💰 $${netProfit.toFixed(2)} (${exitReason})`);

                history.push(winRecord);

                // DO NOT PUSH TO 'updates' (removes from active)
            } else {
                // Keep Active
                updates.push(updatedTrade);
            }

        } catch (e) {
            console.error(`Monitor Error ${trade.symbol}`, e.message);
            updates.push(trade); // Safety: Keep trade if error occurs
        }
    });

    await Promise.all(promises);

    return { active: updates, history: history };
}
