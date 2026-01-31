import axios from 'axios';
import { RSI, EMA } from 'technicalindicators';
import redis from '../src/utils/redisClient.js';
import { v4 as uuidv4 } from 'uuid';

// --- Shared Logic ---
const TOP_PAIRS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'DOTUSDT', 'TRXUSDT',
    'LINKUSDT', 'MATICUSDT', 'LTCUSDT', 'BCHUSDT', 'ATOMUSDT', 'XLMUSDT', 'UNIUSDT', 'FILUSDT', 'HBARUSDT', 'NEARUSDT'
];

// Telegram Config
const BOT_TOKEN = '8025293831:AAF5H56wm1yAzHwbI9foh7lA-tr8WUwHfd0';
const CHAT_ID = '330749449';

// Helper: Fetch Accurate Global Price (Coinbase as Oracle or Binance Global if EU)
async function fetchGlobalPrice(symbol) {
    const REGION = process.env.REGION || 'US'; // Default to US (Vercel)

    // OPTION A: EUROPE (RAILWAY/VPS) -> Use Binance Global Directly
    if (REGION === 'EU') {
        try {
            const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, { timeout: 5000 });
            return parseFloat(res.data.price);
        } catch (e) {
            console.error('Binance Global Price Fail (EU Mode)', e.message);
            // Fallback to Coinbase just in case
        }
    }

    // OPTION B: USA (VERCEL/RAILWAY) -> Use Binance US Priority + Coinbase Fallback
    const base = symbol.replace('USDT', '');
    try {
        // Priority 1: Binance US (More accurate for Binance simulation)
        const res = await axios.get(`https://api.binance.us/api/v3/ticker/price?symbol=${symbol}`, { timeout: 5000 });
        return parseFloat(res.data.price);
    } catch (e) {
        try {
            // Priority 2: Coinbase Oracle (Backup)
            const res = await axios.get(`https://api.coinbase.com/v2/prices/${base}-USD/spot`, { timeout: 5000 });
            return parseFloat(res.data.data.amount);
        } catch (err) {
            console.error(`Price Fetch Failed for ${symbol}`, err.message);
            return null;
        }
    }
}

export default async function handler(req, res) {
    // Set CORS headers for external cron services
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const REGION = process.env.REGION || 'USA';
        console.log(`🤖 Sentinel Bot Waking Up... [REGION: ${REGION}] [METHOD: ${req.method}]`);

        // --- VIP & SAFETY LOGS ---
        if (process.env.BINANCE_API_KEY) {
            console.log('🔐 VIP DATA ACCESS: ENABLED (High Performance Mode)');
        } else {
            console.log('☁️ STANDARD DATA: Public API (Rate Limited)');
        }
        console.log('🛡️ EXECUTION MODE: SIMULATION (Paper Trading Only)');
        // -------------------------

        const alertsSent = [];

        let activeTradesStr = await redis.get('sentinel_active_trades');
        let winHistoryStr = await redis.get('sentinel_win_history');
        let walletConfigStr = await redis.get('sentinel_wallet_config');

        let wallet = walletConfigStr ? JSON.parse(walletConfigStr) : {
            initialBalance: 1000,
            currentBalance: 1000,
            riskPercentage: 10,
            isBotActive: true
        };

        // --- GLOBAL KILL SWITCH ---
        if (wallet.isBotActive === false) {
            console.log('💤 Bot is PAUSED by User. Skipping Scan.');
            return res.status(200).json({ status: 'PAUSED', message: 'Bot Desactivado', alerts: [] });
        }

        // Determine Configured Strategy (Default: SWING)
        let strategy = wallet.strategy || (wallet.multiFrameMode ? 'TRIPLE' : 'SWING');

        // Define Targets based on Strategy
        let PROFIT_TARGET = 1.25; // Default for Swing/Triple
        if (strategy === 'SCALP') PROFIT_TARGET = 0.50; // Tubo Mode: 0.5% Gross (~0.3% Net)

        console.log(`🧠 STRATEGY: ${strategy} | TARGET: ${PROFIT_TARGET}% | MODE: LONG-ONLY 🐂`);

        // Parse active trades and history
        const activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
        const winHistory = winHistoryStr ? JSON.parse(winHistoryStr) : [];


        const newActiveTrades = [...activeTrades];
        const newWins = [];

        // MODE A: INJECTED OPPORTUNITIES (Process Entries)
        const injectedOpportunities = req.body?.opportunities;

        if (req.method === 'POST' && injectedOpportunities && Array.isArray(injectedOpportunities)) {
            console.log(`🚀 Processing ${injectedOpportunities.length} injected opportunities from Frontend`);
            for (const opp of injectedOpportunities) {
                const { symbol, type, price } = opp;
                if (!newActiveTrades.find(t => t.symbol === symbol)) {
                    const risk = wallet.riskPercentage || 10;
                    const investedAmount = wallet.currentBalance * (risk / 100);
                    const openFee = investedAmount * 0.001;
                    wallet.currentBalance -= (investedAmount + openFee);

                    const newTrade = {
                        id: uuidv4(),
                        symbol,
                        entryPrice: price,
                        type,
                        timestamp: new Date().toISOString(),
                        source: 'FORCE_SCAN_WEB',
                        investedAmount: investedAmount,
                        strategy: strategy,
                        isManual: true
                    };
                    newActiveTrades.push(newTrade);

                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        chat_id: CHAT_ID,
                        text: `${type === 'LONG' ? '🔵' : '🔴'} **FORCE ENTRY (${strategy})** ⚡\n\n💎 **Moneda:** ${symbol.replace('USDT', '')}\n🎯 Tipo: ${type}\n💰 Precio: $${price}\n💸 Inv: $${investedAmount.toFixed(2)}\n\n_Manual Force Scan_`,
                        parse_mode: 'Markdown'
                    });
                    alertsSent.push(`${symbol} (${type})`);
                }
            }
        }

        // MODE B: MONITOR & AUTONOMOUS SCAN (ALWAYS RUN MONITORING)
        // 1. Monitor Active Trades (Exits) & 2. Scan for New (if enabled/not forced)

        const promises = TOP_PAIRS.map(async (symbol) => {
            try {
                // 1. Fetch Global Price First (Reliable PnL)
                const currentPrice = await fetchGlobalPrice(symbol);
                if (!currentPrice) return;

                // --- 2. Monitor Existing Trades (Auto-Exit) ---
                const tradeIndex = newActiveTrades.findIndex(t => t.symbol === symbol);
                if (tradeIndex !== -1) {
                    const trade = newActiveTrades[tradeIndex];
                    let pnl = 0;
                    if (trade.type === 'SHORT') {
                        pnl = ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
                    } else {
                        pnl = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
                    }

                    // Determine Target based on Trade's Strategy (with fallback)
                    const tradeStrategy = trade.strategy || strategy;
                    const dynamicTarget = (tradeStrategy === 'SCALP') ? 0.50 : 1.25;

                    // DEBUG LOG (Enhanced)
                    alertsSent.push(`🔍 ${symbol}: $${currentPrice} vs Entry $${trade.entryPrice} -> ${pnl.toFixed(2)}% (${tradeStrategy})`);

                    // EXIT CONDITION
                    if (pnl >= dynamicTarget) {
                        console.log(`🎯 CLOUD WIN (${tradeStrategy}): ${symbol} hit ${pnl.toFixed(2)}% (Target: ${dynamicTarget}%)`);
                        alertsSent.push(`✅ CLOSING ${symbol} (Hit Target)`);

                        // Wallet Credit Logic...
                        let profitUsd = trade.investedAmount * (pnl / 100);
                        const grossReturn = trade.investedAmount + profitUsd;
                        const closeFee = grossReturn * 0.001;
                        const netReturn = grossReturn - closeFee;
                        wallet.currentBalance += netReturn;

                        // Net PnL % calculation
                        const estimatedOpenFee = trade.investedAmount * 0.001;
                        const netProfit = netReturn - trade.investedAmount - estimatedOpenFee;
                        const netPnlPercent = (netProfit / trade.investedAmount) * 100;

                        newWins.push({
                            symbol,
                            pnl: netPnlPercent,
                            profitUsd: netProfit,
                            fees: closeFee,
                            type: trade.type,
                            timestamp: new Date().toISOString(),
                            entryPrice: trade.entryPrice,
                            exitPrice: currentPrice,
                            investedAmount: trade.investedAmount, // Critical Fix for Final Value
                            strategy: tradeStrategy
                        });
                        newActiveTrades.splice(tradeIndex, 1);

                        console.log(`🏆 CIERRE AUTÓNOMO: ${symbol} | PnL: +${netPnlPercent.toFixed(2)}% | Profit: $${netProfit.toFixed(2)}`);

                        // Send Telegram alert (non-blocking)
                        try {
                            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                                chat_id: CHAT_ID,
                                text: `🏆 **CLOUD WIN (${strategy})** 🚀\n\n💎 **Moneda:** ${symbol.replace('USDT', '')}\n📈 ROI: **+${netPnlPercent.toFixed(2)}%**\n💰 Cierre: $${currentPrice}\n\n_Auto-Close by Sentinel_`,
                                parse_mode: 'Markdown'
                            });
                        } catch (telegramError) {
                            console.warn('⚠️ Telegram notification failed:', telegramError.message);
                        }
                    }
                }

                // --- 3. Scan for New Opportunities (Auto-Entry) ---
                // Always scan for new opportunities if no active trade exists for this symbol
                // The bot should be autonomous and enter trades automatically

                if (tradeIndex === -1) {
                    let primaryInterval = strategy === 'SCALP' ? '5m' : '4h';

                    // SMART REGION SWITCHING FOR KLINES
                    let klinesUrl = '';
                    if (REGION === 'EU') {
                        klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${primaryInterval}&limit=250`;
                    } else {
                        // Default to US for Vercel Free
                        klinesUrl = `https://api.binance.us/api/v3/klines?symbol=${symbol}&interval=${primaryInterval}&limit=250`;
                    }

                    const { data: klines } = await axios.get(klinesUrl, { timeout: 5000 });
                    const closes = klines.map(candle => parseFloat(candle[4]));
                    const rsi = RSI.calculate({ values: closes, period: 14 }).slice(-1)[0] || 50;

                    // EMA 200 Calculation (Trend Filter) - Not used for Entry Blocking anymore to match Frontend
                    const ema200Val = EMA.calculate({ values: closes, period: 200 }).slice(-1)[0];

                    // ALIGNMENT WITH FRONTEND (analysis.js):
                    // Frontend 'BUY' signal is purely based on RSI < 30 (Oversold).
                    // We remove 'isBullishTrend' check to ensure "detected opportunities" are executed.
                    let isStrongBuy = false;

                    // --- STRATEGY LOGIC SELECTOR ---
                    if (strategy === 'FLOW') {
                        // 🌊 FLOW MODE: Order Book Imbalance
                        try {
                            const depthResponse = await axios.get((REGION === 'EU' ? 'https://api.binance.com' : 'https://api.binance.us') + `/api/v3/depth?symbol=${symbol}&limit=50`, {
                                timeout: 4000
                            });
                            const depth = depthResponse.data;
                            if (depth && depth.bids && depth.asks) {
                                // Calculate Imbalance
                                const bidVol = depth.bids.slice(0, 20).reduce((acc, [p, q]) => acc + parseFloat(q), 0);
                                const askVol = depth.asks.slice(0, 20).reduce((acc, [p, q]) => acc + parseFloat(q), 0);
                                const buyPressure = askVol > 0 ? bidVol / askVol : 1;

                                // Criterion: 2.0x More Buyers than Sellers
                                isStrongBuy = (buyPressure >= 2.0);
                                console.log(`🌊 ${symbol} | FLOW: ${buyPressure.toFixed(2)}x Pressure | Buy: ${isStrongBuy}`);
                            }
                        } catch (depthErr) {
                            console.warn(`Depth check failed for ${symbol}:`, depthErr.message);
                        }
                    }
                    else if (strategy === 'TRIPLE') {
                        try {
                            // --- TRIPLE LOUPE (15m + 1h + 4h) ---
                            // Respect Region -- Existing Logic
                            const baseUrl = (REGION === 'EU') ? 'https://api.binance.com' : 'https://api.binance.us';

                            const [res1h, res15m] = await Promise.all([
                                axios.get(`${baseUrl}/api/v3/klines?symbol=${symbol}&interval=1h&limit=50`, { timeout: 5000 }),
                                axios.get(`${baseUrl}/api/v3/klines?symbol=${symbol}&interval=15m&limit=50`, { timeout: 5000 })
                            ]);
                            const closes1h = res1h.data.map(c => parseFloat(c[4]));
                            const closes15m = res15m.data.map(c => parseFloat(c[4]));
                            const rsi1h = RSI.calculate({ values: closes1h, period: 14 }).slice(-1)[0] || 50;
                            const rsi15m = RSI.calculate({ values: closes15m, period: 14 }).slice(-1)[0] || 50;

                            isStrongBuy = (rsi < 30 && rsi1h < 30 && rsi15m < 30);
                        } catch (e) { console.warn('Triple Check Fail', e.message); }
                    }
                    else {
                        // DEFAULT: SCALP or SWING (RSI < 30)
                        isStrongBuy = (rsi < 30);
                    }

                    // DEBUG: Log Decision
                    if (strategy !== 'FLOW') console.log(`📊 ${symbol} | RSI: ${rsi.toFixed(2)} | isStrongBuy: ${isStrongBuy} | Strategy: ${strategy}`);

                    if (isStrongBuy) {
                        const type = 'LONG';
                        // Wallet Logic
                        const risk = wallet.riskPercentage || 10;
                        const investedAmount = wallet.currentBalance * (risk / 100);
                        const openFee = investedAmount * 0.001;
                        wallet.currentBalance -= (investedAmount + openFee);

                        const newTrade = {
                            id: uuidv4(),
                            symbol,
                            entryPrice: currentPrice, // FIXED: Use Global Price (Coinbase) to match PnL logic
                            type,
                            timestamp: new Date().toISOString(),
                            investedAmount: investedAmount,
                            strategy: strategy
                        };
                        newActiveTrades.push(newTrade);

                        console.log(`✅ ENTRADA AUTÓNOMA: ${symbol} ${type} @ $${currentPrice} | Strategy: ${strategy}`);

                        // Send Telegram alert (non-blocking)
                        try {
                            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                                chat_id: CHAT_ID,
                                text: `🔵 **CLOUD LONG (${strategy})** 🐂\n\n💎 **Moneda:** ${symbol.replace('USDT', '')}\n🎯 Tipo: LONG\n💰 Precio Entrada: $${currentPrice}\n⏱️ Candles: ${primaryInterval}\n🎯 Target: +${PROFIT_TARGET}%\n\n_REGION: ${REGION}_`,
                                parse_mode: 'Markdown'
                            });
                        } catch (telegramError) {
                            console.warn('⚠️ Telegram notification failed:', telegramError.message);
                        }
                        alertsSent.push(`${symbol} (${type})`);
                    }
                }
            } catch (err) {
                console.error(`Error processing ${symbol}:`, err.message);
            }
        });

        await Promise.all(promises);

        // 4. Save Cloud State
        await redis.set('sentinel_active_trades', JSON.stringify(newActiveTrades));
        await redis.set('sentinel_wallet_config', JSON.stringify(wallet));
        if (newWins.length > 0) {
            const updatedHistory = [...newWins, ...winHistory].slice(0, 50);
            await redis.set('sentinel_win_history', JSON.stringify(updatedHistory));
        }

        res.status(200).json({
            status: 'Process Finished',
            region: REGION, // Return current region for debug
            strategy: strategy,
            activeCount: newActiveTrades.length,
            newAlerts: alertsSent
        });

    } catch (error) {
        console.error('❌ CRITICAL ERROR in check-prices:', error);
        console.error('Error Stack:', error.stack);
        console.error('Error Message:', error.message);
        res.status(500).json({
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
    }
}
