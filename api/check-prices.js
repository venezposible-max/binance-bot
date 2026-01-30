import axios from 'axios';
import { RSI } from 'technicalindicators';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const redis = new Redis(process.env.REDIS_URL);

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
            const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
            return parseFloat(res.data.price);
        } catch (e) {
            console.error('Binance Global Price Fail (EU Mode)', e.message);
            // Fallback to Coinbase just in case
        }
    }

    // OPTION B: USA (VERCEL) -> Use Coinbase Oracle + Binance US Fallback
    const base = symbol.replace('USDT', '');
    try {
        const res = await axios.get(`https://api.coinbase.com/v2/prices/${base}-USD/spot`);
        return parseFloat(res.data.data.amount);
    } catch (e) {
        try {
            const res = await axios.get(`https://api.binance.us/api/v3/ticker/price?symbol=${symbol}`);
            return parseFloat(res.data.price);
        } catch (err) {
            console.error(`Price Fetch Failed for ${symbol}`, err.message);
            return null;
        }
    }
}

export default async function handler(req, res) {
    try {
        const REGION = process.env.REGION || 'US';
        console.log(`🤖 Sentinel Bot Waking Up... [REGION: ${REGION}]`);
        const alertsSent = [];

        let activeTradesStr = await redis.get('sentinel_active_trades');
        let winHistoryStr = await redis.get('sentinel_win_history');
        let walletConfigStr = await redis.get('sentinel_wallet_config');

        let activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
        const winHistory = winHistoryStr ? JSON.parse(winHistoryStr) : [];
        let wallet = walletConfigStr ? JSON.parse(walletConfigStr) : {
            initialBalance: 1000,
            currentBalance: 1000,
            riskPercentage: 10
        };

        // Determine Configured Strategy (Default: SWING)
        let strategy = wallet.strategy || (wallet.multiFrameMode ? 'TRIPLE' : 'SWING');

        // Define Targets based on Strategy
        let PROFIT_TARGET = 1.25; // Default for Swing/Triple
        if (strategy === 'SCALP') PROFIT_TARGET = 0.50; // Tubo Mode: 0.5% Gross (~0.3% Net)

        console.log(`🧠 STRATEGY: ${strategy} | TARGET: ${PROFIT_TARGET}% | MODE: LONG-ONLY 🐂`);

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
                            strategy: tradeStrategy
                        });
                        newActiveTrades.splice(tradeIndex, 1);

                        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                            chat_id: CHAT_ID,
                            text: `🏆 **CLOUD WIN (${strategy})** 🚀\n\n💎 **Moneda:** ${symbol.replace('USDT', '')}\n📈 ROI: **+${netPnlPercent.toFixed(2)}%**\n💰 Cierre: $${currentPrice}\n\n_Auto-Close by Sentinel_`,
                            parse_mode: 'Markdown'
                        });
                    }
                }

                // --- 3. Scan for New Opportunities (Auto-Entry) ---
                // Only run Auto-Scan if NO injected opportunities were provided (Standard Cron Job)
                // If Force Scan was used, we already handled entries in MODE A.
                const isForceScan = (injectedOpportunities && injectedOpportunities.length > 0);

                if (tradeIndex === -1 && !isForceScan) {
                    let primaryInterval = strategy === 'SCALP' ? '5m' : '4h';

                    // SMART REGION SWITCHING FOR KLINES
                    let klinesUrl = '';
                    if (REGION === 'EU') {
                        klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${primaryInterval}&limit=100`;
                    } else {
                        // Default to US for Vercel Free
                        klinesUrl = `https://api.binance.us/api/v3/klines?symbol=${symbol}&interval=${primaryInterval}&limit=100`;
                    }

                    const { data: klines } = await axios.get(klinesUrl);
                    const closes = klines.map(candle => parseFloat(candle[4]));
                    const rsi = RSI.calculate({ values: closes, period: 14 }).slice(-1)[0] || 50;

                    let isStrongBuy = rsi < 30;
                    if (strategy === 'TRIPLE') {
                        try {
                            // --- TRIPLE LOUPE (15m + 1h + 4h) ---
                            // Respect Region
                            const baseUrl = (REGION === 'EU') ? 'https://api.binance.com' : 'https://api.binance.us';

                            const [res1h, res15m] = await Promise.all([
                                axios.get(`${baseUrl}/api/v3/klines?symbol=${symbol}&interval=1h&limit=50`),
                                axios.get(`${baseUrl}/api/v3/klines?symbol=${symbol}&interval=15m&limit=50`)
                            ]);
                            const closes1h = res1h.data.map(c => parseFloat(c[4]));
                            const closes15m = res15m.data.map(c => parseFloat(c[4]));
                            const rsi1h = RSI.calculate({ values: closes1h, period: 14 }).slice(-1)[0] || 50;
                            const rsi15m = RSI.calculate({ values: closes15m, period: 14 }).slice(-1)[0] || 50;

                            isStrongBuy = (rsi < 30 && rsi1h < 30 && rsi15m < 30);
                        } catch (e) { console.warn('Triple Check Fail', e.message); }
                    }

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

                        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                            chat_id: CHAT_ID,
                            text: `🔵 **CLOUD LONG (${strategy})** 🐂\n\n💎 **Moneda:** ${symbol.replace('USDT', '')}\n🎯 Tipo: LONG\n💰 Precio Entrada: $${currentPrice}\n⏱️ Candles: ${primaryInterval}\n🎯 Target: +${PROFIT_TARGET}%\n\n_REGION: ${REGION}_`,
                            parse_mode: 'Markdown'
                        });
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
        console.error(error);
        res.status(500).json({ error: error.message });
    }
}
