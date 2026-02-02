import axios from 'axios';
import { RSI, EMA, BollingerBands } from 'technicalindicators';
import * as analysis from '../src/utils/analysis.js';
import redis from '../src/utils/redisClient.js';
import binanceClient from './utils/binance-client.js'; // Import Unified Client
import { v4 as uuidv4 } from 'uuid';
import { sendRawTelegram } from '../src/utils/telegram.js';

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

// Helper: Fetch Accurate Global Price (Real-time Cache or REST Fallback)
async function fetchGlobalPrice(symbol, cache = null) {
    const REGION = process.env.REGION || 'US';

    // 🚀 OPTION 1: Real-time WebSocket Cache (Zero Latency)
    if (cache && cache[symbol]) {
        const item = cache[symbol];
        return { price: item.price, bid: item.bid, ask: item.ask, source: 'WS_CACHE' };
    }

    // 🐌 OPTION 2: REST Fallback (Latency 200ms+)
    if (REGION === 'EU') {
        try {
            const res = await axios.get(`https://api.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`, { timeout: 3000 });
            return { price: parseFloat(res.data.bidPrice), bid: parseFloat(res.data.bidPrice), ask: parseFloat(res.data.askPrice), source: 'REST_EU' };
        } catch (e) { /* fallback */ }
    }

    const base = symbol.replace('USDT', '');
    try {
        const res = await axios.get(`https://api.binance.us/api/v3/ticker/bookTicker?symbol=${symbol}`, { timeout: 3000 });
        return { price: parseFloat(res.data.bidPrice), bid: parseFloat(res.data.bidPrice), ask: parseFloat(res.data.askPrice), source: 'REST_US' };
    } catch (e) {
        try {
            const res = await axios.get(`https://api.coinbase.com/v2/prices/${base}-USD/spot`, { timeout: 3000 });
            const val = parseFloat(res.data.data.amount);
            return { price: val, bid: val, ask: val, source: 'REST_ORACLE' };
        } catch (err) {
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
        const PORT = process.env.PORT || 8080;
        let alertsSent = 0; // Fixed: Declare to avoid ReferenceError

        // 🚀 PHASE 1: Fetch Real-time Market Cache (Internal Call)
        let marketCache = {};
        try {
            const cacheRes = await axios.get(`http://127.0.0.1:${PORT}/api/market-cache`, { timeout: 1000 });
            marketCache = cacheRes.data;
        } catch (e) {
            console.warn('⚠️ Market Cache Fetch Failed (Using REST Fallback)');
        }

        // 🚀 PHASE 0: Fetch Active Mode and Mode-Specific Config
        const activeMode = await redis.get('sentinel_active_mode') || 'SIMULATION';
        const suffix = activeMode === 'LIVE' ? '_real' : '_sim';
        const configKey = activeMode === 'LIVE' ? 'sentinel_wallet_config_real' : 'sentinel_wallet_config_sim';
        const activeKey = `sentinel_active_trades${suffix}`;
        const historyKey = `sentinel_win_history${suffix}`;
        const sniperKey = `sentinel_sniper_trades${suffix}`;

        console.log(`🤖 Sentinel Bot Waking Up... [MODE: ${activeMode}] [REGION: ${REGION}]`);

        let activeTradesStr = await redis.get(activeKey);
        let winHistoryStr = await redis.get(historyKey);
        let walletConfigStr = await redis.get(configKey);

        // FALLBACK: Migration
        if (activeMode === 'SIMULATION' && !activeTradesStr) {
            const oldActive = await redis.get('sentinel_active_trades');
            if (oldActive) activeTradesStr = oldActive;
            const oldHistory = await redis.get('sentinel_win_history');
            if (oldHistory) winHistoryStr = oldHistory;
        }

        let wallet = walletConfigStr ? JSON.parse(walletConfigStr) : {
            initialBalance: 1000,
            currentBalance: 1000,
            riskPercentage: 10,
            allocatedCapital: 500,
            tradingMode: activeMode,
            isBotActive: true,
            maxTrades: 3,
            dailyLossLimit: 50,
            cooldownMinutes: 30,
            strategyConfig: {
                SNIPER: { active: true },
                HYBRID_SWING: { active: true },
                HYBRID_BLITZ: { active: false }
            }
        };

        // 🛡️ PHASE 3: PORTFOLIO GUARDRAILS
        let activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
        let winHistory = winHistoryStr ? JSON.parse(winHistoryStr) : [];

        // Ensure strategyConfig has a safe fallback even if wallet exists but is old
        if (!wallet.strategyConfig) {
            wallet.strategyConfig = {
                SNIPER: { active: true },
                HYBRID_SWING: { active: true },
                HYBRID_BLITZ: { active: false }
            };
        }

        // 1. MAX ACTIVE TRADES GUARD
        const MAX_TRADES = wallet.maxTrades || 3;
        if (activeTrades.length >= MAX_TRADES) {
            console.log(`🛡️ GUARDRAIL: Max Active Trades (${MAX_TRADES}) reached. Skipping scan.`);
            return res.status(200).json({ status: 'GUARD_LIMIT_REACHED', active: activeTrades.length });
        }

        // 2. DAILY LOSS LIMIT
        const today = new Date().toISOString().split('T')[0];
        const dailyLossAmount = winHistory
            .filter(t => t.timestamp && t.timestamp.startsWith(today) && t.pnlAmount < 0)
            .reduce((sum, t) => sum + Math.abs(t.pnlAmount), 0);

        const MAX_DAILY_LOSS = wallet.dailyLossLimit || (wallet.initialBalance * 0.05);
        if (dailyLossAmount >= MAX_DAILY_LOSS) {
            console.log(`🛡️ GUARDRAIL: Daily Loss Limit ($${dailyLossAmount.toFixed(2)} / $${MAX_DAILY_LOSS.toFixed(2)}) reached. Bot Halted.`);
            return res.status(200).json({ status: 'DAILY_LOSS_LIMIT_REACHED', loss: dailyLossAmount });
        }

        // 3. COOLDOWN PERIOD (e.g., 30 mins after a loss)
        const lastTrade = winHistory.length > 0 ? winHistory[winHistory.length - 1] : null;
        if (lastTrade && lastTrade.pnlAmount < 0) {
            const timeSinceLoss = (new Date() - new Date(lastTrade.timestamp)) / 1000 / 60; // mins
            const COOLDOWN_MINS = wallet.cooldownMinutes || 30;
            if (timeSinceLoss < COOLDOWN_MINS) {
                console.log(`🛡️ GUARDRAIL: Cooldown active (${Math.round(COOLDOWN_MINS - timeSinceLoss)} mins remaining).`);
                return res.status(200).json({ status: 'COOLDOWN_ACTIVE', remaining: Math.round(COOLDOWN_MINS - timeSinceLoss) });
            }
        }

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

        // --- PHASE 5: AI REGIME DETECTION (Global Market Climate) ---
        // Using BTCUSDT as a global proxy for market regime
        let marketRegime = { regime: 'RANGING', label: 'LATERAL ⚖️', multiplier: 1.0 };
        try {
            const baseUrl = (REGION === 'EU') ? 'https://api.binance.com' : 'https://api.binance.us';
            const { data: btcKlines } = await axios.get(`${baseUrl}/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=50`, { timeout: 3000 });
            const processedKlines = btcKlines.map(c => ({
                open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5])
            }));
            const regimeData = analysis.detectRegime(processedKlines);
            const riskMultiplier = analysis.calculateKelly(winHistory);

            marketRegime = { ...regimeData, riskMultiplier };
            console.log(`🧠 AI CLIMATE: ${marketRegime.label} | ADX: ${marketRegime.adx?.toFixed(1)} | Risk Mult: ${riskMultiplier}x`);

            // Sync regime to wallet for UI visibility
            wallet.aiRegime = marketRegime;
        } catch (e) {
            console.warn('AI Regime detection failed, using defaults:', e.message);
        }

        // --- 🧪 MULTI-STRATEGY PARALLEL EXECUTION ---
        // --- 🧪 ELITE HYBRID ENGINE ---
        // Priority Order: SNIPER (Whale Detection) -> HYBRID (Confluence Master)
        // Priority Order: SNIPER -> HYBRID_SWING -> HYBRID_BLITZ
        const STRATEGY_PRIORITY = ['SNIPER', 'HYBRID_SWING', 'HYBRID_BLITZ'];

        // Determine which strategies are ACTIVE strictly based on their individual config
        const strategyConfig = wallet.strategyConfig || {};
        const activeStrategies = STRATEGY_PRIORITY.filter(s => {
            return strategyConfig[s]?.active === true;
        });

        if (activeStrategies.length === 0) {
            console.log('⏹️ ALL STRATEGIES PAUSED: Skipping patrol cycle.');
            return res.status(200).json({
                success: true,
                message: 'All strategies paused.',
                activeCount: 0,
                newAlerts: []
            });
        }

        console.log(`🧠 ACTIVE STRATEGIES: ${activeStrategies.join(', ')}`);

        // Extract User Settings (Apply to all strategies that use them)
        let PROFIT_TARGET = wallet.takeProfit || 1.25;
        const USE_STOP_LOSS = wallet.useStopLoss || false;
        const STOP_LOSS_TARGET = wallet.stopLoss || 3.0; // % distance

        console.log(`🎯 TARGETS: TP ${PROFIT_TARGET}% | SL (Safety): ${USE_STOP_LOSS ? (STOP_LOSS_TARGET + '%') : 'OFF'} | AI SL: ON 🧠`);

        // NOTE: SNIPER is handled by cvd-worker.js WebSocket, not this CRON.
        // It's in activeStrategies for priority tracking (e.g., to reserve BTCUSDT).


        // newActiveTrades and newWins will use the already parsed activeTrades/winHistory from above


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
                        entryFee: openFee, // Store for Forensic Audit
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
            // Determine Hybrid Configuration
            const hybridMode = wallet.hybridMode || 'SWING'; // 'SWING' or 'BLITZ'
            let primaryInterval = wallet.timeframe || (hybridMode === 'BLITZ' ? '1m' : '4h');
            if (!['1m', '5m', '15m', '30m', '1h', '4h', '1d'].includes(primaryInterval)) primaryInterval = (hybridMode === 'BLITZ' ? '1m' : '4h');

            // console.log(`.. 🔎 ANALYZING: ${symbol} [${primaryInterval}]`); // Duplicate removed to show RSI later

            try {
                // 1. Fetch Global Price First (Reliable PnL)
                // NOW RETURNS OBJECT: { price, bid, ask }
                // 1. Fetch Global Price First (Reliable PnL)
                const marketData = await fetchGlobalPrice(symbol, marketCache);
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
                    const tradeStrategy = trade.strategy || strategy;

                    // NEW: Isolate User TP/SL to SWING ONLY
                    let dynamicTarget = (tradeStrategy === 'SCALP') ? 0.80 : (tradeStrategy === 'TRIPLE' ? 3.0 : 1.25); // Tuned for higher Blitz profitability (from 0.50)
                    let slEnforced = false;
                    let customStopLossPrice = trade.stopLoss || trade.dynamicSL || null;
                    let customTakeProfitPrice = trade.takeProfit || trade.dynamicTP || null;

                    if (tradeStrategy === 'SWING') {
                        dynamicTarget = PROFIT_TARGET; // Use the one from wallet (custom)
                        slEnforced = USE_STOP_LOSS;    // Only use SL if strategy is SWING
                    } else if (tradeStrategy === 'OB' || tradeStrategy === 'HYBRID') {
                        slEnforced = true; // OB and HYBRID always use structural SL
                    }

                    // EXIT CONDITION (Take Profit)
                    // Priority: 1. Target from Strategy Logic (ATR-based) | 2. Adaptive Percentage Target
                    const adaptiveTarget = dynamicTarget + (marketRegime.regime === 'TRENDING' ? 0.5 : 0.2);
                    const isTakeProfitHit = customTakeProfitPrice
                        ? (exitPrice >= customTakeProfitPrice)
                        : (pnl >= adaptiveTarget);

                    // EXIT CONDITION (Stop Loss)
                    // Priority: 1. Safety SL from Strategy Logic (ATR-based) | 2. Safety Stop (Global Percentage)
                    let isStopLossHit = false;
                    if (customStopLossPrice) {
                        isStopLossHit = exitPrice <= customStopLossPrice;
                    } else if (slEnforced) {
                        const safetyMargin = STOP_LOSS_TARGET - 0.2; // Subtracting buffer
                        isStopLossHit = (pnl <= -safetyMargin);
                    }

                    // --- EXPERT MODE: BREAKEVEN PROTECTION ---
                    // If trade is in profit > 1.5%, move SL to entry price
                    if (pnl >= 1.5 && !trade.isBreakeven) {
                        trade.stopLoss = trade.entryPrice * 1.001; // Entry + tiny buffer
                        trade.isBreakeven = true;
                        console.log(`🛡️  ${symbol} | BREAKEVEN ACTIVATED (+1.5% hit) | SL moved to entry.`);
                    }

                    // --- EXPERT MODE: TRAILING STOP ---
                    // If trade is in profit > 1.2%, start a trailing stop at 0.5% distance
                    if (pnl >= 1.2) {
                        const trailingDistance = 0.5; // 0.5% trailing distance
                        const newTrailingSL = exitPrice * (1 - (trailingDistance / 100));

                        // Only update if the new trailing SL is higher than the current SL
                        if (!trade.stopLoss || newTrailingSL > trade.stopLoss) {
                            trade.stopLoss = newTrailingSL;
                            trade.isTrailing = true;
                            // console.log(`🚀 ${symbol} | TRAILING SL UPDATED: $${newTrailingSL.toFixed(2)}`);
                        }
                    }

                    if (isTakeProfitHit || isStopLossHit) {
                        const isLive = trade.mode === 'LIVE';
                        const reason = isStopLossHit ? 'STOP LOSS' : 'TARGET HIT (Net)';
                        console.log(`🎯 ${reason} (${tradeStrategy}): ${symbol} ${pnl.toFixed(2)}% | Executing SELL (${isLive ? 'LIVE' : 'SIM'})`);

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
                                fees = grossReturn * 0.001; // Exit Fee
                                const netReturn = grossReturn - fees;
                                wallet.currentBalance += netReturn;

                                // FORENSIC EXACTNESS:
                                // Net Profit = Net Return - (Invested + Entry Fee)
                                const entryFee = trade.entryFee || (trade.investedAmount * 0.001); // Fallback for old trades
                                netProfit = netReturn - trade.investedAmount - entryFee;
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
                    console.log(`.. 🔎 ANALYZING: ${symbol} | RSI: ${rsi.toFixed(2)}`);

                    // EMA 200 Calculation (Trend Filter) - Not used for Entry Blocking anymore to match Frontend
                    const ema200Val = EMA.calculate({ values: closes, period: 200 }).slice(-1)[0];

                    // --- MULTI-STRATEGY ENTRY EVALUATION ---
                    // Loop through active strategies in priority order (already sorted)
                    // Find the FIRST (highest priority) that wants to BUY
                    let winningStrategy = null;
                    let isStrongBuy = false;

                    for (const candidateStrategy of activeStrategies) {
                        // Skip SNIPER (handled by WebSocket)
                        if (candidateStrategy === 'SNIPER') continue;

                        // Check if a trade already exists for this symbol by a HIGHER priority strategy
                        const existingTrade = newActiveTrades.find(t => t.symbol === symbol);
                        if (existingTrade) {
                            const existingPriority = STRATEGY_PRIORITY.indexOf(existingTrade.strategy || 'SWING');
                            const candidatePriority = STRATEGY_PRIORITY.indexOf(candidateStrategy);
                            if (existingPriority <= candidatePriority) {
                                // Existing trade has equal or higher priority, skip
                                continue;
                            }
                        }

                        let candidateBuy = false;

                        // Evaluate entry condition for this strategy
                        // 🧬 HYBRID CONFLUENCE LOGIC (SWING)
                        if (candidateStrategy === 'HYBRID_SWING') {
                            try {
                                const baseUrl = (REGION === 'EU') ? 'https://api.binance.com' : 'https://api.binance.us';
                                const { data: klines } = await axios.get(`${baseUrl}/api/v3/klines?symbol=${symbol}&interval=1h&limit=250`, { timeout: 5000 });
                                const depth = marketCache[symbol]?.depth || { bids: [], asks: [] };

                                const analysis = await import('../src/utils/analysis.js').then(m => m.analyzeHybrid(depth, klines.map(c => ({
                                    open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5])
                                })), { mode: 'SWING' }));

                                candidateBuy = analysis.prediction.signal === 'STRONG_BUY';
                                if (candidateBuy) {
                                    if (analysis.obZone) {
                                        wallet._hybridSwingSL = analysis.obZone.sl;
                                        wallet._hybridSwingTP = analysis.obZone.tp;
                                    }
                                    console.log(`🎯 [HYBRID SWING] ${symbol} | CONFLUENCE DETECTED | Price: $${currentPrice.toFixed(2)}`);
                                }
                            } catch (e) {
                                console.warn(`Hybrid Swing fail for ${symbol}:`, e.message);
                            }
                        }

                        // 🧬 HYBRID CONFLUENCE LOGIC (BLITZ)
                        if (candidateStrategy === 'HYBRID_BLITZ') {
                            try {
                                const baseUrl = (REGION === 'EU') ? 'https://api.binance.com' : 'https://api.binance.us';
                                const { data: klines } = await axios.get(`${baseUrl}/api/v3/klines?symbol=${symbol}&interval=1m&limit=250`, { timeout: 5000 });
                                const depth = marketCache[symbol]?.depth || { bids: [], asks: [] };

                                const analysis = await import('../src/utils/analysis.js').then(m => m.analyzeHybrid(depth, klines.map(c => ({
                                    open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5])
                                })), { mode: 'BLITZ' }));

                                candidateBuy = analysis.prediction.signal === 'STRONG_BUY';
                                if (candidateBuy) {
                                    if (analysis.obZone) {
                                        wallet._hybridBlitzSL = analysis.obZone.sl;
                                        wallet._hybridBlitzTP = analysis.obZone.tp;
                                    }
                                    console.log(`🎯 [HYBRID BLITZ] ${symbol} | CONFLUENCE DETECTED | Price: $${currentPrice.toFixed(2)}`);
                                }
                            } catch (e) {
                                console.warn(`Hybrid Blitz fail for ${symbol}:`, e.message);
                            }
                        }

                        if (candidateBuy) {
                            winningStrategy = candidateStrategy;
                            isStrongBuy = true;
                            break; // First (highest priority) wins
                        }
                    }

                    // Log final decision
                    if (winningStrategy) {
                        console.log(`✅ ${symbol} | WINNER: ${winningStrategy}`);
                    }

                    // LOGIC: EXECUTE TRADE
                    if (isStrongBuy) {
                        const isLive = wallet.tradingMode === 'LIVE';

                        // 1. BALANCE / CAPITAL CHECK
                        // In Sim, use currentBalance. In Live, use allocatedCapital limit.
                        const capitalBase = isLive ? (wallet.allocatedCapital || 500) : wallet.currentBalance;
                        const baseRisk = wallet.riskPercentage || 10;
                        const risk = baseRisk * (marketRegime.riskMultiplier || 1.0);
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
                                entryFee: spentUsd * 0.001, // Store for Forensic Audit
                                strategy: winningStrategy,
                                stopLoss: wallet.useStopLoss ? (winningStrategy === 'HYBRID_SWING' ? wallet._hybridSwingSL : (winningStrategy === 'HYBRID_BLITZ' ? wallet._hybridBlitzSL : (winningStrategy === 'OB' ? wallet._obDynamicSL : (winningStrategy === 'FLOW' ? wallet._flowDynamicSL : null)))) : null,
                                takeProfit: winningStrategy === 'HYBRID_SWING' ? wallet._hybridSwingTP : (winningStrategy === 'HYBRID_BLITZ' ? wallet._hybridBlitzTP : (winningStrategy === 'OB' ? wallet._obDynamicTP : null)),
                                impulse: winningStrategy === 'OB' ? wallet._obImpulse : null,
                                wallPrice: winningStrategy === 'HYBRID' ? wallet._hybridWallPrice : (winningStrategy === 'FLOW' ? wallet._flowWallPrice : null),
                                mode: isLive ? 'LIVE' : 'SIMULATION',
                                orderId: order.orderId
                            };
                            newActiveTrades.push(newTrade);

                            console.log(`✅ ${isLive ? 'LIVE' : 'SIM'} ENTRADA: ${symbol} @ $${fillPrice.toFixed(4)} | Qty: ${executedQty.toFixed(4)}`);

                            // Telegram Alert
                            await sendRawTelegram(`${isLive ? '💸 **LIVE TRADE**' : '🔵 **SIM TRADE**'} (${winningStrategy}) 🐂\n\n💎 **${symbol}**\n💰 Entrada: $${fillPrice.toFixed(4)}\n💸 Inv: $${spentUsd.toFixed(2)}\n⏱️ 1H Candles\n\n_Mode: ${isLive ? 'REAL MONEY' : 'Paper Trading'}_`);

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
        const finalActiveStr = await redis.get(activeKey);
        let freshActiveTrades = finalActiveStr ? JSON.parse(finalActiveStr) : [];

        // 5. SNIPER ENGINE SYNC
        let sniperTradesStr = await redis.get(sniperKey);
        if (activeMode === 'SIMULATION' && !sniperTradesStr) {
            const oldSniper = await redis.get('sentinel_sniper_trades');
            if (oldSniper) sniperTradesStr = oldSniper;
        }
        let sniperTrades = sniperTradesStr ? JSON.parse(sniperTradesStr) : [];

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
        await redis.set(activeKey, JSON.stringify(finalSaveList));
        await redis.set(configKey, JSON.stringify(wallet));
        await redis.set(historyKey, JSON.stringify(winHistory)); // PERSIST HISTORY TO MODE-SPECIFIC KEY
        await redis.set(sniperKey, JSON.stringify(sniperTrades)); // PERSIST SNIPER TO MODE-SPECIFIC KEY

        if (newWins.length > 0) {
            const currentHistoryStr = await redis.get(historyKey);
            const currentHistory = currentHistoryStr ? JSON.parse(currentHistoryStr) : [];
            const updatedHistory = [...newWins, ...currentHistory].slice(0, 50);
            await redis.set(historyKey, JSON.stringify(updatedHistory));
        }

        res.status(200).json({
            status: 'Process Finished',
            region: REGION, // Return current region for debug
            activeStrategies: activeStrategies,
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
