import redis from '../src/utils/redisClient.js';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import binanceClient from './utils/binance-client.js';
import { sendRawTelegram } from '../src/utils/telegram.js';
// Telegram hardcoded config removed - using src/utils/telegram.js

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { action, symbol, price, type, id, exitPrice, strategy } = req.body;

    try {
        // 1. Load Data
        const activeMode = await redis.get('sentinel_active_mode') || 'SIMULATION';
        const suffix = activeMode === 'LIVE' ? '_real' : '_sim';
        const configKey = activeMode === 'LIVE' ? 'sentinel_wallet_config_real' : 'sentinel_wallet_config_sim';
        const activeKey = `sentinel_active_trades${suffix}`;
        const historyKey = `sentinel_win_history${suffix}`;
        const sniperKey = `sentinel_sniper_trades${suffix}`;

        let activeTradesStr = await redis.get(activeKey);
        let winHistoryStr = await redis.get(historyKey);
        let walletConfigStr = await redis.get(configKey);
        let sniperTradesStr = await redis.get(sniperKey);

        // Migration Fallback
        if (activeMode === 'SIMULATION' && !activeTradesStr) {
            const oldActive = await redis.get('sentinel_active_trades');
            if (oldActive) activeTradesStr = oldActive;
            const oldHistory = await redis.get('sentinel_win_history');
            if (oldHistory) winHistoryStr = oldHistory;
            const oldSniper = await redis.get('sentinel_sniper_trades');
            if (oldSniper) sniperTradesStr = oldSniper;
        }

        const activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
        const winHistory = winHistoryStr ? JSON.parse(winHistoryStr) : [];
        const sniperTrades = sniperTradesStr ? JSON.parse(sniperTradesStr) : [];
        const wallet = walletConfigStr ? JSON.parse(walletConfigStr) : {
            initialBalance: 1000,
            currentBalance: 1000,
            riskPercentage: 10,
            tradingMode: activeMode
        };

        if (action === 'OPEN') {
            const { takeProfit, stopLoss } = req.body;
            const risk = wallet.riskPercentage || 10;
            const investedAmount = req.body.amount || (wallet.currentBalance * (risk / 100));
            const openFee = investedAmount * 0.001;
            const isLive = activeMode === 'LIVE';

            let executionPrice = price;
            let orderId = `SIM_${Date.now()}`;
            let executedQty = investedAmount / price;
            let actualSpentUsd = investedAmount;

            if (isLive) {
                console.log(`💸 EXECUTING LIVE MANUAL BUY: ${symbol} for $${investedAmount.toFixed(2)}`);
                try {
                    const order = await binanceClient.executeOrder(symbol, 'BUY', investedAmount, price, 'MARKET', true);
                    orderId = order.orderId;
                    executedQty = parseFloat(order.executedQty);
                    actualSpentUsd = parseFloat(order.cummulativeQuoteQty) || investedAmount;
                    executionPrice = actualSpentUsd / executedQty || price;
                } catch (err) {
                    console.error('🚨 LIVE MANUAL BUY FAILED:', err.message);
                    throw new Error(`Binance Error: ${err.message}`);
                }
            } else {
                // Simulation: Deduct from virtual balance
                wallet.currentBalance -= (investedAmount + openFee);
            }

            const newTrade = {
                id: uuidv4(),
                symbol,
                entryPrice: executionPrice,
                type: type || 'LONG',
                timestamp: new Date().toISOString(),
                isManual: true,
                investedAmount: actualSpentUsd,
                quantity: executedQty,
                strategy: strategy || 'SWING',
                takeProfit,
                stopLoss,
                mode: activeMode,
                orderId: orderId
            };
            activeTrades.push(newTrade);

            // Notify Telegram
            let targetMsg = `\n_Vigilando objetivo +1% en la nube..._`;
            if (takeProfit) {
                const pnl = ((takeProfit - executionPrice) / executionPrice) * 100;
                targetMsg = `\n🎯 **Objetivo (ATR):** $${takeProfit.toFixed(4)} (+${pnl.toFixed(2)}%)`;
            }

            await redis.set(activeKey, JSON.stringify(activeTrades));
            await redis.set(configKey, JSON.stringify(wallet));

            const telegramHeader = isLive ? `👆 **LIVE MANUAL ENTRY** ✅` : `👆 **MANUAL ENTRY** ✍️`;
            const feesMsg = isLive ? "" : `\n📉 Fee: -$${openFee.toFixed(3)}`;

            await sendRawTelegram(`${telegramHeader}\n\n💎 **Moneda:** ${symbol.replace('USDT', '')}\n🎯 Tipo: ${type || 'LONG'}\n💰 Precio: $${executionPrice.toFixed(4)}\n💸 **Inversión:** $${actualSpentUsd.toFixed(2)}${feesMsg}${targetMsg}`);

            return res.status(200).json({ success: true, active: activeTrades, wallet });
        }

    } else if (action === 'CLOSE') {
        // Check both regular and Sniper trades
        let tradeIndex = activeTrades.findIndex(t => t.id === id);
        let isSniper = false;
        let trade = null;

        if (tradeIndex !== -1) {
            trade = activeTrades[tradeIndex];
        } else {
            tradeIndex = sniperTrades.findIndex(t => t.id === id);
            if (tradeIndex !== -1) {
                trade = sniperTrades[tradeIndex];
                isSniper = true;
            }
        }

        if (trade) {
            // --- CRITICAL: Execute Real Sell if LIVE ---
            const isLive = trade.mode === 'LIVE';
            if (isLive) {
                console.log(`💸 Manual Close for LIVE trade: Selling ${trade.symbol} on Binance...`);
                try {
                    // Use quantity if available, else calculate from invested
                    const qty = trade.quantity || (trade.investedAmount / trade.entryPrice);
                    await binanceClient.executeOrder(trade.symbol, 'SELL', qty, exitPrice || trade.entryPrice, 'MARKET', true);
                    console.log('✅ Real SELL executed for manual closure');
                } catch (err) {
                    console.error('❌ FAILED to sell live trade on Binance:', err.message);
                    // We still continue to remove from UI to avoid stuck state, but user is alerted via console
                }
            }

            // Calculate PnL if exitPrice is provided
            if (exitPrice && trade.investedAmount) {
                let pnlPercent = 0;
                if (trade.type === 'SHORT') {
                    pnlPercent = ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
                } else {
                    pnlPercent = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
                }

                const profitValue = trade.investedAmount * (pnlPercent / 100);
                const grossReturn = trade.investedAmount + profitValue;

                // Fee Logic (Exit 0.1%)
                const closeFee = grossReturn * 0.001;
                const netReturn = grossReturn - closeFee;

                // Credit to Wallet
                wallet.currentBalance += netReturn;

                console.log(`💰 Wallet Credit: Returned $${netReturn.toFixed(2)} (Fees: $${closeFee.toFixed(3)})`);

                // Calculate NET PnL % (Real ROI)
                // We assume 0.1% entry fee was paid.
                const estimatedOpenFee = trade.investedAmount * 0.001;
                const netProfit = netReturn - trade.investedAmount - estimatedOpenFee;
                const netPnlPercent = (netProfit / trade.investedAmount) * 100;

                // Add to History (So user can see it)
                let winHistoryStr = await redis.get('sentinel_win_history');
                let winHistory = winHistoryStr ? JSON.parse(winHistoryStr) : [];

                winHistory.unshift({
                    symbol: trade.symbol,
                    pnl: netPnlPercent, // Storing NET PnL now
                    profitUsd: netProfit, // Storing NET Profit ($)
                    type: trade.type,
                    strategy: isSniper ? 'SNIPER' : (trade.strategy || 'MANUAL'),
                    timestamp: new Date().toISOString(),
                    entryPrice: trade.entryPrice,
                    exitPrice: exitPrice || trade.entryPrice,
                    investedAmount: trade.investedAmount, // Critical for Value Amount display
                    isManual: true
                });

                // Keep last 50
                winHistory = winHistory.slice(0, 50);
                await redis.set(historyKey, JSON.stringify(winHistory));
            }

            // Remove from correct array
            if (isSniper) {
                sniperTrades.splice(tradeIndex, 1);
                await redis.set(sniperKey, JSON.stringify(sniperTrades));

                // Activate cooldown to prevent immediate reopening
                await redis.set('sentinel_sniper_cooldown', Date.now().toString());
                console.log('🔫 Sniper cooldown activated (manual close)');
            } else {
                activeTrades.splice(tradeIndex, 1);
                await redis.set(activeKey, JSON.stringify(activeTrades));
            }
        }

    } else if (action === 'CLEAR_HISTORY') {
        await redis.set(historyKey, JSON.stringify([]));
        return res.status(200).json({ success: true, history: [] });
    }

    // Save State (Final Sync)
    await redis.set(activeKey, JSON.stringify(activeTrades));
    await redis.set(configKey, JSON.stringify(wallet));

    res.status(200).json({ success: true, active: activeTrades, wallet });

} catch (error) {
    console.error('Manual Trade Error:', error);
    res.status(500).json({ error: error.message });
}
}
