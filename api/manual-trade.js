
import redis from './utils/redisClient.js';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import binanceClient from './utils/binance-client.js';
import { sendRawTelegram } from '../src/utils/telegram.js';
import { calculateNetProfit } from '../src/utils/finance.js';
import { runWithLock } from './utils/locker.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { action, symbol, price, type, id, exitPrice, strategy } = req.body;

    try {
        // FORENSIC FIX: Prioritize explicit mode from Request (Override), fall back to Global Redis
        const globalMode = await redis.get('sentinel_active_mode') || 'SIMULATION';
        const activeMode = req.body.mode || globalMode;

        // LOCK ENTIRE OPERATION
        const result = await runWithLock(`trades_${activeMode}`, async () => {

            // --- EMERGENCY LOCKDOWN CHECK ---
            const isLocked = await redis.get('sentinel_lockdown') === 'true';
            if (isLocked && action === 'OPEN') {
                throw new Error('⛔ SISTEMA BLOQUEADO POR EMERGENCIA');
            }

            const suffix = activeMode === 'LIVE' ? '_real' : '_sim';
            const configKey = activeMode === 'LIVE' ? 'sentinel_wallet_config_real' : 'sentinel_wallet_config_sim';
            const activeKey = `sentinel_active_trades${suffix}`;
            const historyKey = `sentinel_win_history${suffix}`;
            const sniperKey = `sentinel_sniper_trades${suffix}`;

            let activeTradesStr = await redis.get(activeKey);
            let winHistoryStr = await redis.get(historyKey);
            let walletConfigStr = await redis.get(configKey);
            let sniperTradesStr = await redis.get(sniperKey);

            let activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
            let winHistory = winHistoryStr ? JSON.parse(winHistoryStr) : [];
            let sniperTrades = sniperTradesStr ? JSON.parse(sniperTradesStr) : [];
            const wallet = walletConfigStr ? JSON.parse(walletConfigStr) : {
                initialBalance: 1000,
                currentBalance: 1000,
                riskPercentage: 10,
                tradingMode: activeMode
            };

            // --- ACTION: CLEAR HISTORY ---
            if (action === 'CLEAR_HISTORY') {
                winHistory = [];
                await redis.set(historyKey, JSON.stringify(winHistory));
                return { success: true, history: [] };
            }

            // --- ACTION: OPEN TRADE ---
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
                    const order = await binanceClient.executeOrder(symbol, 'BUY', investedAmount, price, 'MARKET', true);
                    orderId = order.orderId;
                    executedQty = parseFloat(order.executedQty);
                    actualSpentUsd = parseFloat(order.cummulativeQuoteQty) || investedAmount;
                    executionPrice = actualSpentUsd / executedQty || price;
                } else {
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
                const telegramHeader = isLive ? `👆 **LIVE MANUAL ENTRY** ✅` : `👆 **MANUAL ENTRY** ✍️`;
                const feesMsg = isLive ? "" : `\n📉 Fee: -$${openFee.toFixed(3)}`;
                await sendRawTelegram(`${telegramHeader}\n\n💎 **Moneda:** ${symbol.replace('USDT', '')}\n🎯 Tipo: ${type || 'LONG'}\n💰 Precio: $${executionPrice.toFixed(4)}\n💸 **Inversión:** $${actualSpentUsd.toFixed(2)}${feesMsg}${targetMsg}`);
            }

            // --- ACTION: CLOSE TRADE ---
            else if (action === 'CLOSE') {
                let tradeIndex = activeTrades.findIndex(t => t.id === id);
                let trade = activeTrades[tradeIndex];
                let isSniper = false;

                // Fallback: Check Sniper
                if (!trade) {
                    const sIndex = sniperTrades.findIndex(t => t.id === id);
                    if (sIndex !== -1) {
                        trade = sniperTrades[sIndex];
                        isSniper = true;
                        tradeIndex = sIndex;
                    }
                }

                if (trade) {
                    let currentPrice = exitPrice || trade.entryPrice;
                    if (!exitPrice) {
                        try {
                            const ticker = await binanceClient.getTickerPrice(trade.symbol);
                            currentPrice = parseFloat(ticker.price);
                        } catch (e) { console.warn("Price fetch failed manual close", e); }
                    }

                    const qty = trade.quantity || (trade.investedAmount / trade.entryPrice);
                    let netProfit = 0;
                    let executionPrice = currentPrice;

                    // Execute Real Sell
                    if (activeMode === 'LIVE') {
                        try {
                            const order = await binanceClient.executeOrder(trade.symbol, 'SELL', qty, currentPrice, 'MARKET', true);
                            const received = parseFloat(order.cummulativeQuoteQty);
                            const fee = received * 0.001;
                            netProfit = received - trade.investedAmount - (trade.entryFee || 0) - fee;
                            executionPrice = received / parseFloat(order.executedQty) || currentPrice;
                        } catch (err) {
                            if (err.message && (err.message.includes('-2010') || err.message.includes('insufficient'))) {
                                netProfit = 0;
                            } else {
                                throw err;
                            }
                        }
                    } else {
                        // Sim
                        const fee = (trade.investedAmount * 0.001) + (currentPrice * qty * 0.001);
                        netProfit = (currentPrice * qty) - trade.investedAmount - fee;
                        wallet.currentBalance += (trade.investedAmount + netProfit);
                    }

                    const roi = (netProfit / trade.investedAmount) * 100;

                    // Archive
                    winHistory.unshift({
                        ...trade,
                        exitPrice: executionPrice,
                        profitUsd: netProfit,
                        pnl: roi,
                        timestamp: new Date().toISOString(),
                        entryTimestamp: trade.entryTimestamp || trade.timestamp
                    });

                    if (winHistory.length > 50) winHistory.pop();

                    // Remove
                    if (isSniper) {
                        sniperTrades.splice(tradeIndex, 1);
                        await redis.set(sniperKey, JSON.stringify(sniperTrades));
                        await redis.set('sentinel_sniper_cooldown', Date.now().toString());
                    } else {
                        activeTrades.splice(tradeIndex, 1);
                    }

                    const emoji = netProfit >= 0 ? '🟢' : '🔴';
                    const diffMs = new Date() - new Date(trade.timestamp);
                    const hrs = Math.floor(diffMs / 3600000);
                    const mins = Math.floor((diffMs % 3600000) / 60000);
                    const durationStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
                    const closureMsg = `🚨 **[${activeMode}] MANUAL CLOSE: ${trade.symbol}**\n${emoji} ROI: ${roi.toFixed(2)}%\n💰 PnL: $${netProfit.toFixed(2)}\n⏱️ Duración: ${durationStr}`;
                    await sendRawTelegram(closureMsg);
                }
            }

            // --- SAVE STATE (Atomic) ---
            await redis.set(activeKey, JSON.stringify(activeTrades));
            await redis.set(historyKey, JSON.stringify(winHistory));
            await redis.set(configKey, JSON.stringify(wallet));

            return { success: true, active: activeTrades, balance: wallet.currentBalance };

        }, 10000); // 10s Timeout

        res.status(200).json(result);

    } catch (error) {
        console.error('Manual Trade Error:', error);
        res.status(500).json({ error: error.message });
    }
}
