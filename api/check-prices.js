import axios from 'axios';
import { RSI, EMA, BollingerBands } from 'technicalindicators';
import * as analysis from '../src/utils/analysis.js';
import redis from '../src/utils/redisClient.js';
import binanceClient from './utils/binance-client.js';
import { authenticatedRequest } from './utils/binance-client.js';
import { v4 as uuidv4 } from 'uuid';
import { sendRawTelegram } from '../src/utils/telegram.js';

// --- Shared Logic ---
let lastWorkingSource = null;

async function getDynamicTopPairs() {
    const sources = [
        { url: 'https://api.binance.com/api/v3/ticker/24hr', label: 'EU' },
        { url: 'https://api.binance.us/api/v3/ticker/24hr', label: 'USA' }
    ];
    if (lastWorkingSource === 'USA') sources.reverse();
    for (const src of sources) {
        try {
            const res = await axios.get(src.url, { timeout: 5000 });
            if (res.data && Array.isArray(res.data)) {
                lastWorkingSource = src.label;
                const BLACKLIST = ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'AEUR', 'EUR', 'GBP', 'PAXG', 'WBTC', 'USD1', 'USDE', 'SUSD', 'FRAX', 'LUSD', 'GUSD', 'FUSD'];
                const relevant = res.data.filter(p => {
                    if (!p.symbol.endsWith('USDT')) return false;
                    if (BLACKLIST.some(blocked => p.symbol.includes(blocked))) return false;
                    return parseFloat(p.quoteVolume) > 5000000;
                });
                relevant.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
                return relevant.slice(0, 10).map(p => p.symbol);
            }
        } catch (e) {
            console.warn(`⚠️ Dynamic Pairs [${src.label}] Fail: ${e.response?.status === 403 ? '403 Blocked' : e.message}`);
        }
    }
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'BNBUSDT', 'AVAXUSDT', 'LINKUSDT'];
}

async function fetchGlobalPrice(symbol, cache = null) {
    if (cache && cache[symbol]) return { ...cache[symbol], source: 'WS_CACHE' };

    // Updated Sources to use GCP mirror to bypass 403
    const sources = [
        { url: `https://api-gcp.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`, label: 'REST_EU_GCP' },
        { url: `https://api1.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`, label: 'REST_EU_ALT' },
        { url: `https://api.binance.us/api/v3/ticker/bookTicker?symbol=${symbol}`, label: 'REST_US' }
    ];

    const workingLabel = lastWorkingSource || (process.env.REGION === 'EU' ? 'EU' : 'USA');
    if (workingLabel === 'USA') sources.reverse();

    for (const src of sources) {
        try {
            const res = await axios.get(src.url, { timeout: 3000 });
            lastWorkingSource = src.label.includes('US') ? 'USA' : 'EU';
            return { price: parseFloat(res.data.bidPrice), bid: parseFloat(res.data.bidPrice), ask: parseFloat(res.data.askPrice), source: src.label };
        } catch (e) { if (!e.response || e.response.status !== 403) break; }
    }

    const base = symbol.replace('USDT', '');
    try {
        const res = await axios.get(`https://api.coinbase.com/v2/prices/${base}-USD/spot`, { timeout: 3000 });
        const val = parseFloat(res.data.data.amount);
        return { price: val, bid: val, ask: val, source: 'REST_ORACLE' };
    } catch (e) { return null; }
}

async function fetchGlobalKlines(symbol, interval, limit = 250) {
    const sources = [
        { url: `https://api-gcp.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, label: 'EU_GCP' },
        { url: `https://api.binance.us/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, label: 'USA' }
    ];
    const workingLabel = lastWorkingSource || (process.env.REGION === 'EU' ? 'EU' : 'USA');
    if (workingLabel === 'USA') sources.reverse();
    for (const src of sources) {
        try {
            const res = await axios.get(src.url, { timeout: 5000 });
            if (res.data && Array.isArray(res.data)) { lastWorkingSource = src.label; return res.data; }
        } catch (e) { if (!e.response || e.response.status !== 403) break; }
    }
    return null;
}

// --- ⚡ CORE ENGINE (Process a Single Mode: LIVE or SIMULATION) ---
async function processMode(mode, marketPairs, marketCache, marketRegime, manualOpportunities = null) {
    // console.warn(`🐛 DEBUG: STARTING processMode(${mode})`); // REMOVED DEBUG
    const suffix = mode === 'LIVE' ? '_real' : '_sim';
    const configKey = mode === 'LIVE' ? 'sentinel_wallet_config_real' : 'sentinel_wallet_config_sim';
    const activeKey = `sentinel_active_trades${suffix}`;
    const historyKey = `sentinel_win_history${suffix}`;

    let activeTradesStr = await redis.get(activeKey);
    let winHistoryStr = await redis.get(historyKey);
    let walletConfigStr = await redis.get(configKey);

    // console.warn(`🐛 DEBUG: REDIS FETCHED for ${mode}`); // REMOVED DEBUG

    let activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
    let winHistory = winHistoryStr ? JSON.parse(winHistoryStr) : [];
    let wallet = walletConfigStr ? JSON.parse(walletConfigStr) : {
        initialBalance: 1000, currentBalance: 1000, riskPercentage: 10, allocatedCapital: 500,
        tradingMode: mode, isBotActive: true, maxTrades: 3, dailyLossLimit: 50, cooldownMinutes: 30,
        strategyConfig: { SNIPER: { active: true }, HYBRID_SWING: { active: true } }
    };

    const currentStrategy = wallet.strategy || 'SWING';
    const activeColor = mode === 'LIVE' ? '🔴' : '🔵';
    console.log(`${activeColor} [${mode}] STRATEGY: ${currentStrategy} | Active: ${activeTrades.length} | Balance: $${wallet.currentBalance.toFixed(0)}`);

    // --- CRITICAL: Live Position Sync (Auto Discovery) ---
    if (mode === 'LIVE' && activeTrades.length === 0) {
        try {
            // Attempt to fetch open balances/positions from Binance if local state is empty
            const balanceData = await authenticatedRequest('/api/v3/account', 'GET');
            if (balanceData && balanceData.balances) {
                const heldAssets = balanceData.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
                const positions = heldAssets.filter(a => a.asset !== 'USDT' && a.asset !== 'BNB'); // Filter base assets

                if (positions.length > 0) {
                    console.log(`[LIVE] ⚠️ Discovered ${positions.length} held assets on Binance not in Redis. Syncing...`);

                    // Convert to trade objects so the bot can Manage them (SL/TP)
                    const syncedTrades = (await Promise.all(positions.map(async (pos) => {
                        const symbol = `${pos.asset}USDT`;

                        // 🛡️ ZOMBIE PROTECTION: Check if we JUST closed this trade (prevent resurrection via latency)
                        // If we sold it < 2 mins ago, assume this balance is stale or dust we failed to kill
                        const lastClose = winHistory.find(h => h.symbol === symbol && new Date(h.timestamp) > new Date(Date.now() - 120000));
                        if (lastClose) {
                            console.warn(`[LIVE] 🧟 ZOMBIE BLOCKED: Found ${symbol} balance but it was closed recently. Ignoring.`);
                            return null;
                        }

                        const priceData = await fetchGlobalPrice(symbol);
                        const currentPrice = priceData?.price || 0;
                        const qty = parseFloat(pos.free) + parseFloat(pos.locked);
                        const valueUsd = qty * currentPrice;

                        // FILTER DUST: Ignore assets worth less than $5
                        if (valueUsd < 5) return null;

                        return {
                            id: uuidv4(),
                            symbol: symbol,
                            entryPrice: currentPrice, // Approximate
                            investedAmount: valueUsd,
                            quantity: qty,
                            type: 'LONG',
                            timestamp: new Date().toISOString(),
                            strategy: 'MANUAL_SYNC',
                            mode: 'LIVE',
                            isManual: true
                        };
                    }))).filter(t => t !== null); // Remove nulls (dust)

                    if (syncedTrades.length > 0) {
                        activeTrades = syncedTrades;
                        await redis.set(activeKey, JSON.stringify(activeTrades));
                        console.log(`[LIVE] ✅ Application State Synced: ${activeTrades.length} trades adopted (Dust filtered).`);
                    } else {
                        console.log(`[LIVE] 🧹 Only dust found. No trades adopted.`);
                    }

                    activeTrades = syncedTrades;
                    await redis.set(activeKey, JSON.stringify(activeTrades));
                    await redis.set(activeKey, JSON.stringify(activeTrades));
                    console.log(`[LIVE] ✅ Application State Synced: ${activeTrades.length} trades adopted.`);
                }

                // SYNC CASH BALANCE (USDT)
                const usdtAsset = balanceData.balances.find(b => b.asset === 'USDT');
                if (usdtAsset) {
                    const realUsdt = parseFloat(usdtAsset.free);
                    if (Math.abs(wallet.currentBalance - realUsdt) > 1) { // Only sync if meaningful diff
                        console.log(`[LIVE] 💰 Syncing Balance: Redis ($${wallet.currentBalance}) -> Binance ($${realUsdt})`);
                        wallet.currentBalance = realUsdt;
                    }
                }
            }
        } catch (e) {
            console.error(`[LIVE] ⚠️ Sync Failed: ${e.message}`);
        }
    }

    const newActiveTrades = [...activeTrades];
    const newWins = [];

    // --- Process Manual Injected Opportunities ---
    if (manualOpportunities && Array.isArray(manualOpportunities)) {
        for (const opp of manualOpportunities) {
            if (!newActiveTrades.find(t => t.symbol === opp.symbol)) {
                const invested = mode === 'LIVE' ? 20 : (wallet.currentBalance * ((wallet.riskPercentage || 10) / 100));
                const fee = invested * 0.001;
                if (mode === 'SIMULATION') wallet.currentBalance -= (invested + fee);

                const newT = {
                    id: uuidv4(), symbol: opp.symbol, entryPrice: opp.price, type: opp.type, timestamp: new Date().toISOString(),
                    source: 'FORCE_SCAN', investedAmount: invested, entryFee: fee, strategy: 'MANUAL', isManual: true, mode: mode
                };
                newActiveTrades.push(newT);
                await sendRawTelegram(`🚀 **[${mode}] FORCE ENTRY**\n💎 ${opp.symbol}\n💰 Price: $${opp.price}\n\n_Manual Trigger_`);
            }
        }
    }

    // --- Monitor Loop ---
    const activeSymbols = activeTrades.map(t => t.symbol);
    const uniquePairs = Array.from(new Set([...marketPairs, ...activeSymbols]));

    for (const symbol of uniquePairs) {
        try {
            const marketData = await fetchGlobalPrice(symbol, marketCache);
            if (!marketData || !marketData.price) continue;

            const currentPrice = marketData.price;
            const currentBid = marketData.bid;
            const currentAsk = marketData.ask;

            // 1. MONITOR EXITS (Stop Loss Enforcer)
            const tradeIndex = newActiveTrades.findIndex(t => t.symbol === symbol);
            if (tradeIndex !== -1) {
                const trade = newActiveTrades[tradeIndex];
                let exitPrice = trade.type === 'SHORT' ? currentAsk : currentBid;
                let pnl = trade.type === 'SHORT' ? ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100 : ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;

                // LOG MONITORING (User Reassurance)
                console.log(`.. [${mode}] 👁️ MON: ${symbol} | PnL: ${pnl.toFixed(2)}% | SL: -${(wallet.stopLoss || 3.0)}%`);

                // Stop Loss Logic
                let isExit = false;

                // FORCE SL CHECK
                const effectiveSL = wallet.stopLoss || 3.0;
                if (pnl <= -effectiveSL) {
                    console.log(`[${mode}] 🛑 STOP LOSS TRIGGERED for ${symbol} @ ${pnl.toFixed(2)}% (Limit: -${effectiveSL}%)`);
                    isExit = true;
                }

                // Take Profit Logic
                if (pnl >= (wallet.takeProfit || 1.5)) isExit = true;

                if (isExit) {
                    const qty = trade.quantity || (trade.investedAmount / trade.entryPrice);
                    try {
                        console.log(`[${mode}] 📉 CLOSING POSITION: ${symbol} ...`);
                        const order = await binanceClient.executeOrder(symbol, 'SELL', qty, currentPrice, 'MARKET', mode === 'LIVE');

                        const received = parseFloat(order.cummulativeQuoteQty);
                        const fee = received * 0.001;
                        const netProfit = received - trade.investedAmount - (trade.entryFee || 0) - fee;
                        const finalPnl = (netProfit / trade.investedAmount) * 100;

                        if (mode === 'SIMULATION') wallet.currentBalance += (received - fee);

                        newWins.push({ symbol, pnl: finalPnl, profitUsd: netProfit, timestamp: new Date().toISOString(), strategy: trade.strategy, mode: mode });
                        newActiveTrades.splice(tradeIndex, 1);
                        await sendRawTelegram(`🚨 **[${mode}] TRADE CLOSED: ${symbol}**\n📉 ROI: ${finalPnl.toFixed(2)}%\n💰 Profit: $${netProfit.toFixed(2)}`);
                    } catch (e) {
                        console.error(`[${mode}] SELL FAILED: ${symbol}`, e.message);
                    }
                }
            } else {
                // 2. AUTONOMOUS ENTRY SCANNER (The "Brain" on the Server)
                // Only scan if:
                // a) We have slots available (Max Trades)
                // b) Symbol is in our target list (marketPairs)
                // c) Cooldown check passed (simple check to avoid spamming same pair)
                // d) Enough balance

                const maxTrades = wallet.maxTrades || 3;
                if (newActiveTrades.length < maxTrades && marketPairs.includes(symbol)) {
                    try {
                        // Determine Strategy & Timeframe from Wallet Config
                        const strategy = wallet.strategy || 'SWING'; // Default SWING
                        // Force 5m for BLITZ/SCALP, 4h for others
                        const interval = (strategy.includes('BLITZ') || strategy === 'SCALP' || strategy === 'SNIPER') ? '5m' : '4h';

                        // Check Cooldown (Optional: 15 mins per pair)
                        // Implementing a simple in-memory or redis check would be better, but for now we trust the analysis.

                        // FETCH CANDLES
                        const candles = await fetchGlobalKlines(symbol, interval, 50); // Need ~50 for EMA/RSI

                        if (candles && candles.length >= 30) {
                            // RUN ANALYSIS (Shared Logic with Frontend)
                            // We pass the raw klines (Array of arrays). analyzePair handles "c.close" OR "c[4]"
                            const result = analysis.analyzePair(candles, {
                                swingMode: 'AGGRESSIVE', // Server is always aggressive to find opps
                                mode: strategy
                            });

                            const signal = result.prediction?.signal;
                            const intensity = result.prediction?.intensity || 0;

                            // LOG SCAN RESULT (Clean Format)
                            const emoji = signal.includes('BUY') ? '🟢' : (signal.includes('SELL') ? '🔴' : '⚪');
                            console.log(`   > ${symbol} (${interval}): ${emoji} ${signal} (${intensity}%)`);

                            // LOGIC: ONLY ENTER ON "STRONG_BUY" OR HIGH INTENSITY
                            if (signal === 'STRONG_BUY' || (signal === 'BUY' && intensity >= 80)) {
                                console.log(`🚀 [${mode}] AUTO-SIGNAL DETECTED: ${symbol} (${signal} - ${intensity}%)`);

                                // EXECUTE TRADE
                                const risk = wallet.riskPercentage || 10;
                                // Validate Balance
                                const balance = wallet.currentBalance || 0;
                                const amountToInvest = (balance * (risk / 100));

                                if (amountToInvest > 10) { // Min $10
                                    // Prepare Trade Object
                                    let executionPrice = currentPrice;
                                    let orderId = `AUTO_${Date.now()}`;
                                    let executedQty = amountToInvest / currentPrice;
                                    let actualSpent = amountToInvest;

                                    // EXECUTE ON BINANCE (If Live)
                                    let success = true;
                                    if (mode === 'LIVE') {
                                        try {
                                            console.log(`💸 AUTO-BUYING ${symbol} on BINANCE...`);
                                            const order = await binanceClient.executeOrder(symbol, 'BUY', amountToInvest, currentPrice, 'MARKET', true);
                                            // Update details from real execution
                                            executedQty = parseFloat(order.executedQty);
                                            actualSpent = parseFloat(order.cummulativeQuoteQty);
                                            executionPrice = actualSpent / executedQty;
                                        } catch (err) {
                                            console.error(`❌ AUTO-BUY FAILED: ${err.message}`);
                                            success = false;
                                        }
                                    } else {
                                        // SIMULATION
                                        wallet.currentBalance -= (amountToInvest * 1.001); // Deduct + Fee
                                    }

                                    if (success) {
                                        const newTrade = {
                                            id: uuidv4(),
                                            symbol: symbol,
                                            entryPrice: executionPrice,
                                            investedAmount: actualSpent,
                                            quantity: executedQty,
                                            type: 'LONG',
                                            timestamp: new Date().toISOString(),
                                            strategy: strategy + '_AUTO', // Tag as Auto
                                            mode: mode,
                                            isManual: false,
                                            // Set ATR Targets if available from analysis
                                            takeProfit: null, // Let the main monitor handle generic TP, or extract from result if OB
                                            stopLoss: null
                                        };

                                        newActiveTrades.push(newTrade);
                                        await sendRawTelegram(`🤖 **[${mode}] AUTONOMOUS ENTRY**\n🚀 **${symbol}**\n🔥 Signal: ${signal}\n💰 Entry: $${executionPrice.toFixed(4)}\n💸 Invested: $${actualSpent.toFixed(2)}`);
                                    }
                                }
                            }
                        }
                    } catch (scanErr) {
                        console.warn(`Scanner verify failed for ${symbol}: ${scanErr.message}`);
                    }
                }
            }
        } catch (e) { console.error(`[${mode}] Error processing ${symbol}:`, e.message); }
    }

    // --- Save States ---
    await redis.set(activeKey, JSON.stringify(newActiveTrades));
    await redis.set(configKey, JSON.stringify(wallet));
    if (newWins.length > 0) {
        const h = JSON.parse(await redis.get(historyKey) || '[]');
        await redis.set(historyKey, JSON.stringify([...newWins, ...h].slice(0, 50)));
    }
    return { mode, activeCount: newActiveTrades.length, alerts: [] };
}

export default async function handler(req, res) {
    console.log('🚀 [DUAL ENGINE] check-prices START');
    try {
        const marketCache = {};
        const marketPairs = await getDynamicTopPairs();

        // Parallel Processing
        // Parallel Processing
        const activeModeUI = await redis.get('sentinel_active_mode') || 'SIMULATION';
        const tasks = [];

        // Only run SIMULATION if users wants it or we are NOT in LIVE prioritized mode
        // User requested "Quita los trades falsos", so if KEY exists, we focus on LIVE.
        // ALWAYS RUN BOTH MODES (User Request: "Los dos a la vez")
        // This ensures he can test strategies in SIM while earning money in LIVE.
        tasks.push(processMode('SIMULATION', marketPairs, marketCache, null, null));

        if (process.env.BINANCE_API_KEY) {
            tasks.push(processMode('LIVE', marketPairs, marketCache, null, null));
        }

        await Promise.all(tasks);
        res.status(200).json({ status: 'OK' });
    } catch (error) {
        console.error('❌ CRITICAL ERROR:', error.message);
        res.status(500).json({ error: error.message });
    }
}
