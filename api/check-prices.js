import axios from 'axios';
import { RSI, EMA, BollingerBands } from 'technicalindicators';
import redis from '../src/utils/redisClient.js';
import binanceClient from './utils/binance-client.js'; // Import Unified Client
import { v4 as uuidv4 } from 'uuid';

// --- Shared Logic ---
// --- Shared Logic ---
// Removed STATIC TOP_PAIRS list in favor of Dynamic Volume Fetching

async function getDynamicTopPairs() {
    try {
        const REGION = process.env.REGION || 'US';
        const baseUrl = REGION === 'EU' ? 'https://api.binance.com' : 'https://api.binance.us';
        const res = await axios.get(`${baseUrl}/api/v3/ticker/24hr`, { timeout: 5000 });
        const allPairs = res.data;

        // Explicit Blacklist (Matches Frontend)
        const BLACKLIST = [
            'USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'AEUR', 'EUR', 'GBP',
            'PAXG', 'WBTC', 'USD1', 'USDE', 'SUSD', 'FRAX', 'LUSD', 'GUSD', 'FUSD'
        ];

        const relevant = allPairs.filter(p => {
            if (!p.symbol.endsWith('USDT')) return false;
            const isBlacklisted = BLACKLIST.some(blocked => p.symbol.includes(blocked));
            if (isBlacklisted) return false;
            if (p.symbol.includes('USDC')) return false; // Extra safety

            // Volume Filter (Min 5M)
            return parseFloat(p.quoteVolume) > 5000000;
        });

        // Sort by Volume (Desc)
        relevant.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

        // Return Top 10 Symbols
        return relevant.slice(0, 10).map(p => p.symbol);
    } catch (e) {
        if (e.response && e.response.status === 403) {
            console.warn('⚠️ Dynamic Pairs: API Access 403 (Region Blocked/WAF) - Using Fallback');
        } else {
            console.warn('⚠️ Dynamic Pair Fetch Failed:', e.message);
        }
        // Fallback List if API fails
        return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'BNBUSDT', 'AVAXUSDT', 'LINKUSDT'];
    }
}

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
    console.log('🚀 [API] check-prices handler STARTED'); // Confirm request arrival
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

        // --- NEW DYNAMIC LOGIC ---
        let marketPairs = [];
        try {
            marketPairs = await getDynamicTopPairs();
        } catch (e) {
            console.error('CRITICAL: Failed to get dynamic pairs', e);
            marketPairs = ['BTCUSDT', 'ETHUSDT'];
        }

        // Merge with Active Trades to ensure we monitor open positions
        const activeSymbols = activeTrades.map(t => t.symbol);
        const uniquePairs = Array.from(new Set([...marketPairs, ...activeSymbols]));

        console.log(`🔍 SCANNED PAIRS (${uniquePairs.length}):`, uniquePairs.join(', '));

        const promises = uniquePairs.map(async (symbol) => {
            try {
                // 1. Fetch Global Price First (Reliable PnL)
                // NOW RETURNS OBJECT: { price, bid, ask }
                const marketData = await fetchGlobalPrice(symbol);
                if (!marketData || !marketData.price) return;

                const currentPrice = marketData.price; // For logging/display
                const currentBid = marketData.bid;     // Execution Price for Selling (Closing Longs)
                const currentAsk = marketData.ask;     // Execution Price for Buying (Closing Shorts / Opening Longs)

                // --- 2. Monitor Existing Trades (Auto-Exit) ---
                const tradeIndex = newActiveTrades.findIndex(t => t.symbol === symbol);
                if (tradeIndex !== -1) {
                    const trade = newActiveTrades[tradeIndex];
                    let pnl = 0;

                    // REALISTIC PNL CALCULATION (SPREAD AWARE)
                    let exitPrice = currentPrice;

                    if (trade.type === 'SHORT') {
                        // Closing Short = Buying Back at ASK Price
                        exitPrice = currentAsk;
                        pnl = ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
                    } else {
                        // Closing Long = Selling at BID Price
                        exitPrice = currentBid;
                        pnl = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
                    }

                    // Determine Target based on Trade's Strategy (with fallback)
                    // Determine Target based on Trade's Strategy (with fallback)
                    const tradeStrategy = trade.strategy || strategy;
                    const dynamicTarget = (tradeStrategy === 'SCALP') ? 0.50 : 1.25;

                    // DEBUG LOG (Enhanced)
                    alertsSent.push(`🔍 ${symbol}: Entry $${trade.entryPrice} vs Current $${currentPrice} -> ${pnl.toFixed(2)}%`);

                    // EXIT CONDITION
                    if (pnl >= dynamicTarget) {
                        const isLive = trade.mode === 'LIVE';
                        console.log(`🎯 TARGET HIT (${tradeStrategy}): ${symbol} ${pnl.toFixed(2)}% | Executing SELL (${isLive ? 'LIVE' : 'SIM'})`);

                        try {
                            // Determine Qty to Sell
                            // Fallback for old trades: invested / entry
                            const qtyToSell = trade.quantity || (trade.investedAmount / trade.entryPrice);

                            // EXECUTE SELL
                            const order = await binanceClient.executeOrder(symbol, 'SELL', qtyToSell, currentPrice);

                            // Parse Result
                            const executedQty = parseFloat(order.executedQty);
                            const receivedUsd = parseFloat(order.cummulativeQuoteQty);
                            const exitPrice = receivedUsd / executedQty || currentPrice;

                            // Wallet Logic
                            let netProfit = 0;
                            let fees = 0;

                            if (isLive) {
                                // LIVE PnL
                                fees = receivedUsd * 0.001; // Est. Fee
                                netProfit = receivedUsd - trade.investedAmount - fees;
                                // In LIVE, we don't update wallet.currentBalance for the bot logic, we just log it.
                                // But maybe users want to see "Bot Balance" grow?
                                // Let's Sync it roughly just for UI fun, but trust Binance Balance mostly.
                            } else {
                                // SIM PnL
                                let profitUsd = trade.investedAmount * (pnl / 100);
                                const grossReturn = trade.investedAmount + profitUsd;
                                fees = grossReturn * 0.001;
                                const netReturn = grossReturn - fees;
                                wallet.currentBalance += netReturn;
                                netProfit = netReturn - trade.investedAmount;
                            }

                            const pnlPercent = (netProfit / trade.investedAmount) * 100;

                            alertsSent.push(`✅ CLOSING ${symbol} (Hit Target) at $${exitPrice.toFixed(4)}`);

                            newWins.push({
                                symbol,
                                pnl: pnlPercent,
                                profitUsd: netProfit,
                                fees: fees,
                                type: trade.type,
                                timestamp: new Date().toISOString(),
                                entryPrice: trade.entryPrice,
                                exitPrice: exitPrice,
                                investedAmount: trade.investedAmount,
                                strategy: tradeStrategy,
                                mode: isLive ? 'LIVE' : 'SIMULATION',
                                orderId: order.orderId
                            });
                            newActiveTrades.splice(tradeIndex, 1);

                            console.log(`🏆 WIN: ${symbol} | PnL: +${pnlPercent.toFixed(2)}% | Profit: $${netProfit.toFixed(2)}`);

                            // Telegram Alert
                            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                                chat_id: CHAT_ID,
                                text: `🏆 **CLOUD WIN (${strategy})** 🚀\n\n💎 **${symbol}**\n📈 ROI: **+${pnlPercent.toFixed(2)}%**\n💰 Cierre: $${exitPrice.toFixed(4)}\n💵 Profit: $${netProfit.toFixed(2)}\n\n_Mode: ${isLive ? 'REAL MONEY' : 'Paper Trading'}_`,
                                parse_mode: 'Markdown'
                            }).catch(e => { });

                        } catch (err) {
                            console.error(`🚨 SELL FAILED (${symbol}):`, err.message);
                            alertsSent.push(`⚠️ SELL ERROR ${symbol}: ${err.message}`);
                        }
                    }
                }

                // --- 3. Scan for New Opportunities (Auto-Entry) ---
                // Always scan for new opportunities if no active trade exists for this symbol
                // The bot should be autonomous and enter trades automatically

                if (tradeIndex === -1) {
                    let primaryInterval = strategy === 'SCALP' ? '5m' : '1h'; // Default to 1h for more signals (was 4h)

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
                    } else {
                        // DEFAULT: SCALP, SWING, or Fallback
                        // Lógica Combinada: RSI < 30 (Clásico) OR Bollinger Band Sniper (Frontend Parity)

                        // 3. Calculate Bollinger Bands (20 period, 2 stdDev)
                        const bbValues = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
                        const currentBB = bbValues[bbValues.length - 1] || null;
                        const lastPrice = closes[closes.length - 1];

                        let sniperBuy = false;
                        if (currentBB) {
                            sniperBuy = (rsi < 30 && lastPrice <= currentBB.lower);
                        }

                        if (sniperBuy) {
                            console.log(`🎯 ${symbol} | SNIPER SIGNAL (RSI ${rsi.toFixed(2)} + BB Touch)`);
                            isStrongBuy = true;
                        } else {
                            isStrongBuy = (rsi < 30);
                        }
                    }

                    // DEBUG: Log Decision Reason
                    let reason = '';
                    if (strategy === 'FLOW') reason = `Pressure: ${typeof buyPressure !== 'undefined' ? buyPressure.toFixed(2) : 'N/A'}`;
                    else reason = `RSI: ${rsi.toFixed(2)}`;

                    if (strategy !== 'FLOW') console.log(`📊 ${symbol} | ${reason} | Buy: ${isStrongBuy} | ${strategy}`);

                    // LOGIC: EXECUTE TRADE
                    if (isStrongBuy) {
                        const isLive = wallet.tradingMode === 'LIVE';

                        // 1. BALANCE / CAPITAL CHECK
                        // In Sim, use currentBalance. In Live, use allocatedCapital limit.
                        const capitalBase = isLive ? (wallet.allocatedCapital || 500) : wallet.currentBalance;
                        const risk = wallet.riskPercentage || 10;
                        let investedAmount = capitalBase * (risk / 100);

                        // Safety: Min Order Size (Binance usually 5-10 USDT)
                        if (investedAmount < 6) {
                            if (!isLive) console.warn(`⚠️ Skipping: Investment $${investedAmount.toFixed(2)} too low`);
                            return;
                        }

                        // Simulation Balance Check
                        if (!isLive && wallet.currentBalance < investedAmount) {
                            console.warn(`⚠️ SIM SKIPPING ${symbol}: Insufficient Balance`);
                            alertsSent.push(`⚠️ ${symbol}: Saldo virtual insuficiente`);
                            return;
                        }

                        // EXECUTE ORDER (REAL OR SIM)
                        const type = 'LONG';
                        console.log(`🚀 EXECUTING ${isLive ? 'LIVE 💸' : 'SIM 🧪'} BUY: ${symbol} $${investedAmount.toFixed(2)}`);

                        try {
                            // Pass currentPrice for Sim Math accuracy
                            const order = await binanceClient.executeOrder(symbol, 'BUY', investedAmount, currentPrice);

                            // Parse Result
                            const executedQty = parseFloat(order.executedQty);
                            const spentUsd = parseFloat(order.cummulativeQuoteQty);
                            const fillPrice = spentUsd / executedQty || currentPrice;

                            // Update Virtual Wallet if Sim
                            if (!isLive) {
                                wallet.currentBalance -= (spentUsd + (spentUsd * 0.001)); // Fee sim
                            }

                            // Record Trade
                            const newTrade = {
                                id: uuidv4(),
                                symbol,
                                entryPrice: fillPrice,
                                type,
                                timestamp: new Date().toISOString(),
                                investedAmount: spentUsd,
                                quantity: executedQty, // Save COIN Qty for Selling
                                strategy: strategy,
                                mode: isLive ? 'LIVE' : 'SIMULATION',
                                orderId: order.orderId
                            };
                            newActiveTrades.push(newTrade);

                            console.log(`✅ ${isLive ? 'LIVE' : 'SIM'} ENTRADA: ${symbol} @ $${fillPrice.toFixed(4)} | Qty: ${executedQty.toFixed(4)}`);

                            // Telegram Alert
                            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                                chat_id: CHAT_ID,
                                text: `${isLive ? '💸 **LIVE TRADE**' : '🔵 **SIM TRADE**'} (${strategy}) 🐂\n\n💎 **${symbol}**\n💰 Entrada: $${fillPrice.toFixed(4)}\n💸 Inv: $${spentUsd.toFixed(2)}\n⏱️ 1H Candles\n\n_Mode: ${isLive ? 'REAL MONEY' : 'Paper Trading'}_`,
                                parse_mode: 'Markdown'
                            }).catch(e => console.warn('Telegram Fail'));

                            alertsSent.push(`${symbol} (LONG)`);

                        } catch (err) {
                            console.error(`🚨 EXECUTION FAILED (${symbol}):`, err.message);
                            alertsSent.push(`⚠️ ERROR ${symbol}: ${err.message}`);
                        }
                    }
                }
            } catch (err) {
                if (err.response && err.response.status === 403) {
                    console.log(`⛔ ${symbol}: 403 Forbidden (Region/IP Blocked)`);
                } else {
                    console.error(`Error processing ${symbol}:`, err.message);
                }
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
