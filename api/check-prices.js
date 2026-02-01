import axios from 'axios';
import { RSI, EMA, BollingerBands } from 'technicalindicators';
import redis from '../src/utils/redisClient.js';
import binanceClient from './utils/binance-client.js'; // Import Unified Client
import { v4 as uuidv4 } from 'uuid';
import { sendRawTelegram } from '../src/utils/telegram.js';

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

// Telegram hardcoded config removed - using src/utils/telegram.js

// Helper: Fetch Accurate Global Price (Coinbase as Oracle or Binance Global if EU)
async function fetchGlobalPrice(symbol) {
    const REGION = process.env.REGION || 'US'; // Default to US (Vercel)

    // OPTION A: EUROPE (RAILWAY/VPS) -> Use Binance Global Directly
    if (REGION === 'EU') {
        try {
            const res = await axios.get(`https://api.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`, { timeout: 5000 });
            return { price: parseFloat(res.data.bidPrice), bid: parseFloat(res.data.bidPrice), ask: parseFloat(res.data.askPrice) };
        } catch (e) {
            console.error('Binance Global Price Fail (EU Mode)', e.message);
            // Fallback to Coinbase just in case
        }
    }

    // OPTION B: USA (VERCEL/RAILWAY) -> Use Binance US Priority + Coinbase Fallback
    const base = symbol.replace('USDT', '');
    try {
        // Priority 1: Binance US (More accurate for Binance simulation)
        const res = await axios.get(`https://api.binance.us/api/v3/ticker/bookTicker?symbol=${symbol}`, { timeout: 5000 });
        return { price: parseFloat(res.data.bidPrice), bid: parseFloat(res.data.bidPrice), ask: parseFloat(res.data.askPrice) };
    } catch (e) {
        try {
            // Priority 2: Coinbase Oracle (Backup)
            const res = await axios.get(`https://api.coinbase.com/v2/prices/${base}-USD/spot`, { timeout: 5000 });
            const val = parseFloat(res.data.data.amount);
            return { price: val, bid: val, ask: val };
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
        const alertsSent = [];

        let activeTradesStr = await redis.get('sentinel_active_trades');
        let winHistoryStr = await redis.get('sentinel_win_history');
        let walletConfigStr = await redis.get('sentinel_wallet_config');

        let wallet = walletConfigStr ? JSON.parse(walletConfigStr) : {
            initialBalance: 1000,
            currentBalance: 1000,
            riskPercentage: 10,
            allocatedCapital: 500, // Default
            tradingMode: 'SIMULATION', // Default
            isBotActive: true
        };

        // DYNAMIC LOGGING & BALANCE CHECK
        let realBalance = null;
        if (wallet.tradingMode === 'LIVE') {
            try {
                const balanceData = await binanceClient.getAccountBalance('USDT');
                if (balanceData.error) {
                    console.log('⛔ API KEY ERROR: ' + balanceData.error);
                } else {
                    realBalance = balanceData.available;
                    console.log(`💸 EXECUTION MODE: LIVE MONEY | 💰 WALLET: $${realBalance.toFixed(2)} USDT`);
                }
            } catch (e) {
                console.log('⛔ BINANCE API EXCEPTION: ' + e.message);
            }
        } else {
            console.log('🛡️ EXECUTION MODE: SIMULATION (Paper Trading Only)');
        }

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

        // 🔫 SNIPER MODE: Skip Cron Execution (Handled by cvd-worker.js WebSocket)
        if (strategy === 'SNIPER') {
            console.log('🔫 SNIPER MODE ACTIVE: Skipping cron scan (WebSocket handles BTCUSDT only)');

            // Still monitor existing trades for TP/SL
            const activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
            const winHistory = winHistoryStr ? JSON.parse(winHistoryStr) : [];

            return res.status(200).json({
                success: true,
                message: 'Sniper mode: Monitoring only',
                activeCount: activeTrades.length,
                newAlerts: []
            });
        }


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

                    await sendRawTelegram(`${type === 'LONG' ? '🔵' : '🔴'} **FORCE ENTRY (${strategy})** ⚡\n\n💎 **Moneda:** ${symbol.replace('USDT', '')}\n🎯 Tipo: ${type}\n💰 Precio: $${price}\n💸 Inv: $${investedAmount.toFixed(2)}\n\n_Manual Force Scan_`);
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

        console.log(`🔍 SCANNED PAIRS (${uniquePairs.length}):`, uniquePairs.join(', '));

        // SEQUENTIAL LOOP (Par por Par - User Request)
        for (const symbol of uniquePairs) {
            // Determine Timeframe EARLY for logging
            let primaryInterval = wallet.timeframe || (strategy === 'SCALP' ? '5m' : '4h');
            if (!['1m', '5m', '15m', '30m', '1h', '4h', '1d'].includes(primaryInterval)) primaryInterval = '4h';

            // console.log(`.. 🔎 ANALYZING: ${symbol} [${primaryInterval}]`); // Duplicate removed to show RSI later

            try {
                // 1. Fetch Global Price First (Reliable PnL)
                // NOW RETURNS OBJECT: { price, bid, ask }
                // 1. Fetch Global Price First (Reliable PnL)
                const marketData = await fetchGlobalPrice(symbol);
                if (!marketData || !marketData.price) {
                    console.warn(`.. ⚠️ NO PRICE: ${symbol} (Skipping)`);
                    continue; // Skip execution for this pair
                }

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

                            // EXECUTE SELL (Pass isLive Override)
                            const order = await binanceClient.executeOrder(symbol, 'SELL', qtyToSell, currentPrice, 'MARKET', isLive);

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
                            await sendRawTelegram(`🏆 **CLOUD WIN (${strategy})** 🚀\n\n💎 **${symbol}**\n📈 ROI: **+${pnlPercent.toFixed(2)}%**\n💰 Cierre: $${exitPrice.toFixed(4)}\n💵 Profit: $${netProfit.toFixed(2)}\n\n_Mode: ${isLive ? 'REAL MONEY' : 'Paper Trading'}_`);

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
                    // DYNAMIC TELESCOPE: Use User's Timeframe or Fallback
                    let primaryInterval = wallet.timeframe || (strategy === 'SCALP' ? '5m' : '4h');
                    // ensure valid interval
                    if (!['1m', '5m', '15m', '30m', '1h', '4h', '1d'].includes(primaryInterval)) primaryInterval = '4h';

                    // Log moved to post-calculation for visibility

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

                    // ✨ HYBRID LOG: Analysis + Result (User Request)
                    console.log(`.. 🔎 ANALYZING: ${symbol} [${primaryInterval}] | RSI: ${rsi.toFixed(2)}`);

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
                    else if (strategy === 'SCALP') {
                        // ⚡ SCALP MODE: Quick entries on 5m/15m charts
                        // Logic: RSI Oversold (Classic)
                        isStrongBuy = (rsi < 30);
                        if (isStrongBuy) console.log(`⚡ ${symbol} | SCALP SIGNAL (RSI ${rsi.toFixed(2)})`);
                    }
                    else {
                        // 🐂 SWING MODE (Default): Deep Dips on 4h charts
                        // Logic: RSI < 30 OR Sniper (RSI < 30 + Lower Bollinger Band)

                        // Bollinger Bands (20, 2)
                        const bbValues = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
                        const currentBB = bbValues[bbValues.length - 1] || null;
                        const lastPrice = closes[closes.length - 1];

                        let sniperBuy = false;
                        if (currentBB && ema200Val) {
                            // Filter: Price MUST be above EMA 200 for SWING entries
                            sniperBuy = (rsi < 30 && lastPrice <= currentBB.lower && lastPrice > ema200Val);
                        }

                        if (sniperBuy) {
                            console.log(`🎯 ${symbol} | SWING SNIPER (RSI ${rsi.toFixed(2)} + BB Touch)`);
                            isStrongBuy = true;
                        } else {
                            isStrongBuy = (rsi < 30);
                        }
                    }

                    // DEBUG: Log Decision Reason
                    let reason = '';
                    if (strategy === 'FLOW') reason = `Pressure: ${typeof buyPressure !== 'undefined' ? buyPressure.toFixed(2) : 'N/A'}`;
                    else reason = `RSI: ${rsi.toFixed(2)}`;

                    if (strategy !== 'FLOW') console.log(`📊 ${symbol} | ${reason} | Buy: ${isStrongBuy}`);

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
                            const order = await binanceClient.executeOrder(symbol, 'BUY', investedAmount, currentPrice, 'MARKET', isLive);

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
                            await sendRawTelegram(`${isLive ? '💸 **LIVE TRADE**' : '🔵 **SIM TRADE**'} (${strategy}) 🐂\n\n💎 **${symbol}**\n💰 Entrada: $${fillPrice.toFixed(4)}\n💸 Inv: $${spentUsd.toFixed(2)}\n⏱️ 1H Candles\n\n_Mode: ${isLive ? 'REAL MONEY' : 'Paper Trading'}_`);

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
        } // End of Sequential Loop

        // Promises removed (Sequential Mode)

        // --- SAFE SYNC LOGIC (Prevents Zombie Trades) ---
        // 1. Re-fetch current state from Redis to see if user closed trades manually
        const finalActiveStr = await redis.get('sentinel_active_trades');
        let freshActiveTrades = finalActiveStr ? JSON.parse(finalActiveStr) : [];

        // 2. Identify trades we closed in THIS process
        const initialIds = activeTrades.map(t => t.id);
        const currentIds = newActiveTrades.map(t => t.id);
        const closedByUs = initialIds.filter(id => !currentIds.includes(id));

        // 3. Merge: Keep everything in Redis EXCEPT what WE closed
        // Also add anything NEW we opened (that isn't already there)
        const finalSaveList = freshActiveTrades.filter(t => !closedByUs.includes(t.id));

        // Add new trades we opened that might not be in Redis yet
        for (const newT of newActiveTrades) {
            if (!finalSaveList.find(t => t.id === newT.id)) {
                finalSaveList.push(newT);
            }
        }

        // 4. Final Save
        await redis.set('sentinel_active_trades', JSON.stringify(finalSaveList));
        await redis.set('sentinel_wallet_config', JSON.stringify(wallet));

        if (newWins.length > 0) {
            const currentHistoryStr = await redis.get('sentinel_win_history');
            const currentHistory = currentHistoryStr ? JSON.parse(currentHistoryStr) : [];
            const updatedHistory = [...newWins, ...currentHistory].slice(0, 50);
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
