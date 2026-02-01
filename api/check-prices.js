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

        // --- 🧪 MULTI-STRATEGY PARALLEL EXECUTION ---
        // Priority Order (Higher = More Priority)
        const STRATEGY_PRIORITY = ['SNIPER', 'FLOW', 'OB', 'SWING', 'SCALP', 'TRIPLE'];

        // Determine which strategies are ACTIVE
        const strategyConfig = wallet.strategyConfig || {};
        const activeStrategies = STRATEGY_PRIORITY.filter(s => {
            if (strategyConfig[s]) return strategyConfig[s].active === true;
            // Fallback: If no config, check if it's the "main" selected strategy
            return s === (wallet.strategy || 'SWING') && wallet.isBotActive !== false;
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

        console.log(`🎯 TARGETS: TP ${PROFIT_TARGET}% | SL: ${USE_STOP_LOSS ? (STOP_LOSS_TARGET + '%') : 'OFF'}`);

        // NOTE: SNIPER is handled by cvd-worker.js WebSocket, not this CRON.
        // It's in activeStrategies for priority tracking (e.g., to reserve BTCUSDT).


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
                    const tradeStrategy = trade.strategy || strategy;

                    // NEW: Isolate User TP/SL to SWING ONLY
                    let dynamicTarget = (tradeStrategy === 'SCALP') ? 0.50 : (tradeStrategy === 'TRIPLE' ? 3.0 : 1.25);
                    let slEnforced = false;
                    let customStopLossPrice = trade.dynamicSL || null;
                    let customTakeProfitPrice = trade.dynamicTP || null;

                    if (tradeStrategy === 'SWING') {
                        dynamicTarget = PROFIT_TARGET; // Use the one from wallet (custom)
                        slEnforced = USE_STOP_LOSS;    // Only use SL if strategy is SWING
                    } else if (tradeStrategy === 'OB') {
                        slEnforced = true; // OB always uses its structural SL
                    }

                    // EXIT CONDITION (Take Profit)
                    // If OB has a price-based TP, use that. Otherwise use % based target.
                    const isTakeProfitHit = customTakeProfitPrice
                        ? (exitPrice >= customTakeProfitPrice)
                        : (pnl >= (dynamicTarget + 0.2));

                    // EXIT CONDITION (Stop Loss)
                    // If OB has a price-based SL, use that. Otherwise use % based target for SWING.
                    let isStopLossHit = false;
                    if (customStopLossPrice) {
                        isStopLossHit = exitPrice <= customStopLossPrice;
                    } else if (slEnforced) {
                        const grossSL = STOP_LOSS_TARGET - 0.2;
                        isStopLossHit = (pnl <= -grossSL);
                    }

                    // --- EXPERT MODE: BREAKEVEN PROTECTION ---
                    // If trade is in profit > 1.5%, move SL to entry price
                    if (pnl >= 1.5 && !trade.isBreakeven) {
                        trade.dynamicSL = trade.entryPrice * 1.001; // Entry + tiny buffer
                        trade.isBreakeven = true;
                        console.log(`🛡️  ${symbol} | BREAKEVEN ACTIVATED (+1.5% hit) | SL moved to entry.`);
                    }

                    // --- EXPERT MODE: TRAILING STOP ---
                    // If trade is in profit > 1.2%, start a trailing stop at 0.5% distance
                    if (pnl >= 1.2) {
                        const trailingDistance = 0.5; // 0.5% trailing distance
                        const newTrailingSL = exitPrice * (1 - (trailingDistance / 100));

                        // Only update if the new trailing SL is higher than the current SL
                        if (!trade.dynamicSL || newTrailingSL > trade.dynamicSL) {
                            trade.dynamicSL = newTrailingSL;
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
                        if (candidateStrategy === 'FLOW') {
                            try {
                                const depthResponse = await axios.get((REGION === 'EU' ? 'https://api.binance.com' : 'https://api.binance.us') + `/api/v3/depth?symbol=${symbol}&limit=50`, { timeout: 4000 });
                                const depth = depthResponse.data;
                                if (depth && depth.bids && depth.asks) {
                                    // Identify the "Master Wall" (Highest Volume Bid in Top 20)
                                    const topBids = depth.bids.slice(0, 20);
                                    let masterWall = { price: 0, volume: 0 };
                                    topBids.forEach(([price, qty]) => {
                                        const v = parseFloat(qty);
                                        if (v > masterWall.volume) masterWall = { price: parseFloat(price), volume: v };
                                    });

                                    const bidVol = topBids.reduce((acc, [p, q]) => acc + parseFloat(q), 0);
                                    const askVol = depth.asks.slice(0, 20).reduce((acc, [p, q]) => acc + parseFloat(q), 0);
                                    const buyPressure = askVol > 0 ? bidVol / askVol : 1;

                                    candidateBuy = (buyPressure >= 2.0);

                                    if (candidateBuy) {
                                        // Set Dynamic SL below the Master Wall
                                        // If wall is too close or far, use a safeguard buffer
                                        const structuralSL = masterWall.price * 0.997; // -0.3% below the wall

                                        wallet._flowDynamicSL = structuralSL;
                                        wallet._flowWallPrice = masterWall.price;
                                        wallet._flowRatio = buyPressure;

                                        console.log(`🌊 ${symbol} | FLOW: ${buyPressure.toFixed(2)}x Pressure | Master Wall: $${masterWall.price.toFixed(2)} | SL: $${structuralSL.toFixed(2)}`);
                                    }
                                }
                            } catch (e) { /* ignore */ }
                        }
                        else if (candidateStrategy === 'OB') {
                            // 📦 ORDER BLOCK STRATEGY: Detect institutional zones
                            try {
                                // Fetch 4H klines for OB detection
                                const baseUrl = (REGION === 'EU') ? 'https://api.binance.com' : 'https://api.binance.us';
                                const obRes = await axios.get(`${baseUrl}/api/v3/klines?symbol=${symbol}&interval=4h&limit=50`, { timeout: 5000 });
                                const obKlinesRaw = obRes.data;

                                // Detect Bullish Order Block
                                // Look for impulse move (+2% min) and mark last bearish candle as OB
                                const closes = obKlinesRaw.map(c => parseFloat(c[4]));
                                const ema200_4h = EMA.calculate({ period: 200, values: closes }).slice(-1)[0];
                                const isAboveTrend = currentPrice > ema200_4h;

                                if (!isAboveTrend) {
                                    // EXPERT MODE: Skip if below EMA 200 (Macro Trend is Bearish)
                                    continue;
                                }

                                for (let i = obKlinesRaw.length - 2; i > obKlinesRaw.length - 25 && i > 0; i--) {
                                    const candle = obKlinesRaw[i];
                                    const prevCandle = obKlinesRaw[i - 1];

                                    const candleClose = parseFloat(candle[4]);
                                    const prevOpen = parseFloat(prevCandle[1]);
                                    const prevClose = parseFloat(prevCandle[4]);
                                    const prevHigh = parseFloat(prevCandle[2]);
                                    const prevLow = parseFloat(prevCandle[3]);

                                    // Check for bullish impulse: candle closed +2% higher than prev open
                                    const impulse = ((candleClose - prevOpen) / prevOpen) * 100;
                                    const prevWasBearish = prevClose < prevOpen;

                                    if (impulse >= 2.0 && prevWasBearish) {
                                        // OB zone: prevLow to prevHigh
                                        const obLow = prevLow;
                                        const obHigh = prevHigh;
                                        const obMid = (obLow + obHigh) / 2; // 50% EQUILIBRIUM ENTRY

                                        // EXPERT MODE: Entry at 50% of the zone (obMid)
                                        // We trigger if current price is BETWEEN obLow and obMid (deeper entry)
                                        if (currentPrice >= obLow && currentPrice <= obMid) {
                                            candidateBuy = true;

                                            // SL: Just below OB low (-0.3% buffer)
                                            // TP: Based on impulse size from the 50% entry
                                            const dynamicSL = obLow * 0.997;
                                            const dynamicTP = currentPrice * (1 + (impulse / 100));

                                            wallet._obDynamicSL = dynamicSL;
                                            wallet._obDynamicTP = dynamicTP;
                                            wallet._obImpulse = impulse;
                                            wallet._obEntryType = '50%_EQUILIBRIUM';

                                            console.log(`📦 [EXPERT OB] ${symbol} | Precision Entry at $${currentPrice.toFixed(2)} (Mid: $${obMid.toFixed(2)}) | Trend: OK (> EMA 200) | Impulse: +${impulse.toFixed(1)}% | SL: $${dynamicSL.toFixed(2)}`);
                                            break;
                                        }
                                    }
                                }
                            } catch (e) {
                                console.warn(`OB detection failed for ${symbol}:`, e.message);
                            }
                        }
                        else if (candidateStrategy === 'TRIPLE') {
                            try {
                                const baseUrl = (REGION === 'EU') ? 'https://api.binance.com' : 'https://api.binance.us';
                                const [res1h, res15m] = await Promise.all([
                                    axios.get(`${baseUrl}/api/v3/klines?symbol=${symbol}&interval=1h&limit=50`, { timeout: 5000 }),
                                    axios.get(`${baseUrl}/api/v3/klines?symbol=${symbol}&interval=15m&limit=50`, { timeout: 5000 })
                                ]);
                                const rsi1h = RSI.calculate({ values: res1h.data.map(c => parseFloat(c[4])), period: 14 }).slice(-1)[0] || 50;
                                const rsi15m = RSI.calculate({ values: res15m.data.map(c => parseFloat(c[4])), period: 14 }).slice(-1)[0] || 50;
                                candidateBuy = (rsi < 30 && rsi1h < 30 && rsi15m < 30);
                                if (candidateBuy) console.log(`🔬 ${symbol} | TRIPLE: RSI 4h/1h/15m ALL < 30 | TRIGGERED`);
                            } catch (e) { /* ignore */ }
                        }
                        else if (candidateStrategy === 'SCALP') {
                            candidateBuy = (rsi < 30);
                            if (candidateBuy) console.log(`⚡ ${symbol} | SCALP SIGNAL (RSI ${rsi.toFixed(2)})`);
                        }
                        else if (candidateStrategy === 'SWING') {
                            const bbValues = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
                            const currentBB = bbValues[bbValues.length - 1] || null;
                            const lastPrice = closes[closes.length - 1];
                            const swingMode = wallet.swingMode || 'CONSERVATIVE';
                            const emaFilter = swingMode === 'CONSERVATIVE' ? (lastPrice > ema200Val) : true;
                            let sniperBuy = currentBB && (rsi < 30 && lastPrice <= currentBB.lower && emaFilter);
                            candidateBuy = sniperBuy || (rsi < 30);
                            if (candidateBuy) console.log(`🐂 ${symbol} | SWING SIGNAL (RSI ${rsi.toFixed(2)})`);
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
                                entryFee: spentUsd * 0.001, // Store for Forensic Audit
                                strategy: winningStrategy,
                                dynamicSL: winningStrategy === 'OB' ? wallet._obDynamicSL : (winningStrategy === 'FLOW' ? wallet._flowDynamicSL : null),
                                dynamicTP: winningStrategy === 'OB' ? wallet._obDynamicTP : null,
                                impulse: winningStrategy === 'OB' ? wallet._obImpulse : null,
                                wallPrice: winningStrategy === 'FLOW' ? wallet._flowWallPrice : null,
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
