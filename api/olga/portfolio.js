import binanceClient from '../utils/binance-client.js';
import redis from '../utils/redisClient.js'; // NEW: To fetch active bot trades
import axios from 'axios';

export default async function handler(req, res) {
    try {
        console.log('💰 OLGA PORTFOLIO CHECK INITIATED');

        const responseData = {
            total_usd: "0.00",
            pnl_today: "0.00", // Will be updated with realized + unrealized
            positions_count: 0,
            positions: [],
            active_trades: [], // NEW: Detailed bot trades
            spot_details: []
        };

        // 0. FETCH REAL-TIME PRICES FIRST 🚀
        const prices = {};
        try {
            // Using a public endpoint to get latest prices for accurate PnL
            const tickerRes = await axios.get('https://api.binance.com/api/v3/ticker/price', { timeout: 3000 });
            tickerRes.data.forEach(t => {
                prices[t.symbol] = parseFloat(t.price);
            });
        } catch (e) {
            console.warn('⚠️ Portfolio Price Fetch Failed:', e.message);
        }

        // 1. FETCH ACTIVE BOT TRADES FROM REDIS
        let botUnrealizedPnL = 0;
        try {
            const activeTradesStr = await redis.get('sentinel_active_trades_real');
            if (activeTradesStr) {
                const activeTrades = JSON.parse(activeTradesStr);

                responseData.active_trades = activeTrades.map(t => {
                    // REAL-TIME PRICE FIX 🚀
                    const currentPrice = prices[t.symbol] || parseFloat(t.currentPrice || t.entryPrice);
                    const entryPrice = parseFloat(t.entryPrice);
                    const quantity = parseFloat(t.quantity);

                    // PnL & ROI Calculation
                    const pnlRaw = (currentPrice - entryPrice) * quantity;
                    const roi = ((currentPrice - entryPrice) / entryPrice) * 100;

                    botUnrealizedPnL += pnlRaw;

                    return {
                        symbol: t.symbol,
                        entry: entryPrice.toFixed(4),
                        current: currentPrice.toFixed(4),
                        quantity: quantity,
                        pnl_usd: pnlRaw.toFixed(2),
                        roi_percent: roi.toFixed(2),
                        strategy: t.strategy || 'MANUAL'
                    };
                });

                responseData.positions_count = activeTrades.length;
                // Initial PnL for today from bot trades
                responseData.pnl_today = botUnrealizedPnL.toFixed(2);
            }
        } catch (redisErr) {
            console.warn('⚠️ Redis Trade Fetch Failed:', redisErr.message);
        }

        // 1.5 FETCH HISTORY (TODAY'S METRICS) 📜
        try {
            const historyStr = await redis.get('sentinel_win_history');
            const history = historyStr ? JSON.parse(historyStr) : [];

            // Filter TODAY
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

            const todayTrades = history.filter(t => {
                const exitTime = new Date(t.timestamp).getTime();
                return exitTime >= startOfDay;
            });

            const totalProfitUsd = todayTrades.reduce((sum, t) => sum + (parseFloat(t.profitUsd) || 0), 0);
            const totalRoi = todayTrades.reduce((sum, t) => sum + (parseFloat(t.pnl) || 0), 0);
            const uniqueStrategies = [...new Set(todayTrades.map(t => t.strategy || 'MANUAL'))];

            // Duration Calc
            let totalDurationMs = 0;
            todayTrades.forEach(t => {
                if (t.entryTimestamp && t.timestamp) {
                    totalDurationMs += (new Date(t.timestamp) - new Date(t.entryTimestamp));
                }
            });
            const avgDurationMs = todayTrades.length > 0 ? totalDurationMs / todayTrades.length : 0;
            const hours = Math.floor(avgDurationMs / (1000 * 60 * 60));
            const minutes = Math.floor((avgDurationMs % (1000 * 60 * 60)) / (1000 * 60));

            responseData.history_metrics = {
                count: todayTrades.length,
                net_profit: totalProfitUsd.toFixed(2),
                strategy_roi: totalRoi.toFixed(2),
                strategies: uniqueStrategies,
                avg_duration: `${hours}h ${minutes}m`
            };

            // Update Net PnL to include Realized Profit from today
            // Note: responseData.pnl_today previously only had unrealized. 
            // We'll rename the previous to 'unrealized_today' mentally or just sum them.
            // Let's sum them for a "Total Daily PnL" view (Realized + Unrealized)
            responseData.pnl_today = (parseFloat(responseData.pnl_today) + totalProfitUsd).toFixed(2);

        } catch (histErr) {
            console.warn('⚠️ History Fetch Failed:', histErr.message);
            responseData.history_metrics = { count: 0, net_profit: "0.00", strategy_roi: "0.00", strategies: [], avg_duration: "0m" };
        }


        // 2. SPOT ACCOUNT SNAPSHOT
        // We use the account endpoint to get all balances
        const spotData = await binanceClient.authenticatedRequest('/api/v3/account');

        let spotTotalUSDT = 0;
        const significantBalances = [];

        // (Prices already fetched at top for global use)

        spotData.balances.forEach(b => {
            const total = parseFloat(b.free) + parseFloat(b.locked);
            if (total > 0) {
                let usdtValue = 0;
                if (b.asset === 'USDT' || b.asset === 'USDC' || b.asset === 'FDUSD') {
                    usdtValue = total;
                } else {
                    // Try to find PAIR-USDT
                    const pair = `${b.asset}USDT`;
                    if (prices[pair]) {
                        usdtValue = total * prices[pair];
                    }
                }

                if (usdtValue > 1) { // Only count dust > $1
                    spotTotalUSDT += usdtValue;
                    significantBalances.push({ asset: b.asset, qty: total.toFixed(4), usd: usdtValue.toFixed(2) });
                }
            }
        });

        responseData.spot_details = significantBalances;

        // 3. FUTURES ACCOUNT (If enabled/accessible)
        // We need to sign a request to FAPI. binance-client might default to Spot URL base.
        // We need to construct a custom FAPI request manually or extend the client.
        // For simplicity, let's try to reuse the signing logic but force the FAPI domain if possible.
        // But binance-client 'privateRequest' uses 'getBaseUrl()'.

        // Let's implement a manual FAPI call here reusing the secrets from process.env
        try {
            const crypto = await import('crypto');
            const querystring = await import('querystring');

            const apiKey = process.env.BINANCE_API_KEY;
            const apiSecret = process.env.BINANCE_API_SECRET;
            const fapiBase = 'https://fapi.binance.com';

            if (apiKey && apiSecret) {
                const ts = Date.now();
                const q = `timestamp=${ts}`;
                const sig = crypto.createHmac('sha256', apiSecret).update(q).digest('hex');

                const fAccount = await axios.get(`${fapiBase}/fapi/v2/account?${q}&signature=${sig}`, {
                    headers: { 'X-MBX-APIKEY': apiKey }
                });

                const fData = fAccount.data;
                const futBal = parseFloat(fData.totalWalletBalance || 0);
                const futUnrealized = parseFloat(fData.totalUnrealizedProfit || 0);

                // Add futures unrealized PnL to bot PnL
                responseData.pnl_today = (parseFloat(responseData.pnl_today) + futUnrealized).toFixed(2);

                // Get Positions
                if (fData.positions) {
                    const activePos = fData.positions.filter(p => parseFloat(p.positionAmt) !== 0);
                    // If bot trades exist, add futures positions to the count, otherwise set it
                    responseData.positions_count = responseData.positions_count + activePos.length;
                    responseData.positions = activePos.map(p => ({
                        symbol: p.symbol,
                        size: p.positionAmt,
                        pnl: p.unrealizedProfit,
                        leverage: p.leverage
                    }));
                }

                // Total is Spot + Futures Equity
                // Note: futures 'totalWalletBalance' is the margin balance.
                // We sum Spot USDT Value + Futures Wallet Balance + Unrealized PnL
                const total = spotTotalUSDT + futBal + futUnrealized;
                responseData.total_usd = total.toFixed(2);

            } else {
                // If only Spot keys are valid or Futures disabled, just show Spot
                responseData.total_usd = spotTotalUSDT.toFixed(2);
            }

        } catch (fErr) {
            console.warn('Futures fetch failed (maybe permissions?):', fErr.message);
            // Fallback to just Spot
            responseData.total_usd = spotTotalUSDT.toFixed(2);
        }

        res.json(responseData);

    } catch (error) {
        console.error('Olga Portfolio Error:', error);
        res.status(500).json({ error: 'Failed to fetch portfolio', details: error.message });
    }
}
// FORCE RAILWAY DEPLOY - TIMESTAMP: 1770693600000
