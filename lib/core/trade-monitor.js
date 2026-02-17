
import binanceClient from '../utils/binance-client.js';
import { sendServerTelegram } from '../utils/telegram-server.js';

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

            // 5. EXIT CONDITIONS CHECK
            const hasSpecificSL = updatedTrade.stopLoss !== null && updatedTrade.stopLoss !== undefined;
            const globalTP = walletConfig.takeProfit || 1.5;

            // Priority: Trade TP > Global Config TP
            let finalTPPerc = globalTP;
            if (trade.takeProfit) {
                // Convert price-based TP to percentage logic if stored as price, 
                // OR if stored as absolute price, check price directly.
                // Currently BLITZ stores Absolute Price in 'takeProfit'.

                // Absolute Price Check
                if (trade.type === 'LONG' && currentPrice >= trade.takeProfit) { isExit = true; exitReason = 'TP_HIT'; }
                if (trade.type === 'SHORT' && currentPrice <= trade.takeProfit) { isExit = true; exitReason = 'TP_HIT'; }
            } else {
                // Percentage fallback
                if (pnl >= finalTPPerc) { isExit = true; exitReason = 'GLOBAL_TP_HIT'; }
            }

            // Stop Loss Check
            if (hasSpecificSL) {
                if (trade.type === 'LONG' && currentPrice <= updatedTrade.stopLoss) { isExit = true; exitReason = 'SL_HIT'; }
                else if (trade.type === 'SHORT' && currentPrice >= updatedTrade.stopLoss) { isExit = true; exitReason = 'SL_HIT'; }
            }

            // 6. EXECUTE EXIT
            if (isExit) {
                console.log(`[${mode}] 📉 CLOSING POSITION: ${symbol} (${exitReason}) PnL: ${pnl.toFixed(2)}%`);

                const qty = trade.quantity || (trade.investedAmount / trade.entryPrice);
                let netProfit = 0, finalPercent = 0, executionPrice = currentPrice;

                if (mode === 'LIVE') {
                    try {
                        const order = await binanceClient.executeOrder(symbol, 'SELL', qty, currentPrice, 'MARKET', true);
                        const received = parseFloat(order.cummulativeQuoteQty);
                        const fee = received * 0.001; // Approx fee
                        netProfit = received - trade.investedAmount - (trade.entryFee || 0) - fee;
                        finalPercent = (netProfit / trade.investedAmount) * 100;
                        executionPrice = received / parseFloat(order.executedQty) || currentPrice;
                    } catch (err) {
                        console.error(`❌ LIVE EXIT FAILED for ${symbol}:`, err.message);
                        // Emergency fallback: If error is strictly about balance/filters, we might force close locally
                        // but for 'LIVE', we usually retry. For now, we assume successful close in DB to avoid stuck loop if it's a "dust" issue.
                        if (err.message.includes('LOT_SIZE') || err.message.includes('insufficient')) {
                            // Force close in DB, assume partial fill or dust loss
                            netProfit = 0; finalPercent = 0;
                        } else {
                            // Network error? Keep trade active to retry next cycle
                            updates.push(updatedTrade);
                            return;
                        }
                    }
                } else {
                    // SIMULATION MATH
                    const simQty = trade.quantity || (trade.investedAmount / trade.entryPrice);
                    const entryFee = trade.investedAmount * 0.001;
                    const exitFee = (currentPrice * simQty) * 0.001;
                    const totalFee = entryFee + exitFee;

                    let grossProfit = 0;
                    if (trade.type === 'SHORT') {
                        grossProfit = (trade.entryPrice - currentPrice) * simQty;
                    } else {
                        grossProfit = (currentPrice - trade.entryPrice) * simQty;
                    }

                    netProfit = grossProfit - totalFee;
                    finalPercent = (netProfit / trade.investedAmount) * 100;
                    executionPrice = currentPrice;
                }

                // Create Win Record
                const winRecord = {
                    ...trade,
                    pnl: finalPercent || 0,
                    profitUsd: netProfit || 0,
                    timestamp: new Date().toISOString(), // Exit Time
                    entryTimestamp: trade.timestamp,
                    exitPrice: executionPrice,
                    exitReason: exitReason,
                    closeReason: 'AUTO_CLOSE' // 👈 NEW: Mark as automatic close
                };

                // Notification - USING SERVER DIRECT SEND
                const emoji = netProfit >= 0 ? '🟢' : '🔴';
                await sendServerTelegram(`🚨 **[${mode}] AUTO CLOSE: ${symbol}**\n${emoji} ROI: ${finalPercent.toFixed(2)}%\n💰 $${netProfit.toFixed(2)} (${exitReason})`);

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
