import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

const redis = new Redis(process.env.REDIS_URL, {
    family: 6 // Railway IPv6 Fix
});
const BOT_TOKEN = '8025293831:AAF5H56wm1yAzHwbI9foh7lA-tr8WUwHfd0';
const CHAT_ID = '330749449';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { action, symbol, price, type, id, exitPrice } = req.body;

    try {
        // 1. Load Data
        let activeTradesStr = await redis.get('sentinel_active_trades');
        let walletConfigStr = await redis.get('sentinel_wallet_config');

        let activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
        let wallet = walletConfigStr ? JSON.parse(walletConfigStr) : {
            initialBalance: 1000,
            currentBalance: 1000,
            riskPercentage: 10
        };

        if (action === 'OPEN') {
            // Calculate Position Size
            const risk = wallet.riskPercentage || 10;
            const investedAmount = wallet.currentBalance * (risk / 100);

            // Fee Logic (Maker/Taker 0.1%)
            const openFee = investedAmount * 0.001;

            // Deduct from Balance (Investment + Fee)
            wallet.currentBalance -= (investedAmount + openFee);

            const newTrade = {
                id: uuidv4(),
                symbol,
                entryPrice: price,
                type, // 'LONG' or 'SHORT'
                timestamp: new Date().toISOString(),
                isManual: true,
                investedAmount: investedAmount // Track investment
            };
            activeTrades.push(newTrade);

            // Notify Telegram
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: CHAT_ID,
                text: `👆 **MANUAL ENTRY** ✍️\n\n💎 **Moneda:** ${symbol.replace('USDT', '')}\n🎯 Tipo: ${type}\n💰 Precio: $${price}\n💸 **Inversión:** $${investedAmount.toFixed(2)}\n📉 Fee: -$${openFee.toFixed(3)}\n\n_Vigilando objetivo +1% en la nube..._`,
                parse_mode: 'Markdown'
            });

        } else if (action === 'CLOSE') {
            const tradeIndex = activeTrades.findIndex(t => t.id === id);
            if (tradeIndex !== -1) {
                const trade = activeTrades[tradeIndex];

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
                        timestamp: new Date().toISOString(),
                        entryPrice: trade.entryPrice,
                        exitPrice: exitPrice || trade.entryPrice,
                        isManual: true
                    });

                    // Keep last 50
                    winHistory = winHistory.slice(0, 50);
                    await redis.set('sentinel_win_history', JSON.stringify(winHistory));
                }

                activeTrades.splice(tradeIndex, 1);
            }

        } else if (action === 'CLEAR_HISTORY') {
            await redis.set('sentinel_win_history', JSON.stringify([]));
            return res.status(200).json({ success: true, history: [] });
        }

        // Save State
        await redis.set('sentinel_active_trades', JSON.stringify(activeTrades));
        await redis.set('sentinel_wallet_config', JSON.stringify(wallet));

        res.status(200).json({ success: true, active: activeTrades, wallet });

    } catch (error) {
        console.error('Manual Trade Error:', error);
        res.status(500).json({ error: error.message });
    }
}
