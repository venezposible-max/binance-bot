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

    // GOD-MODE OPTIMIZATION: Parallel Redis Fetch (Reduce RTT)
    const [activeTradesStr, winHistoryStr, walletConfigStr] = await redis.mget([activeKey, historyKey, configKey]);

    // console.warn(`🐛 DEBUG: REDIS FETCHED for ${mode}`); // REMOVED DEBUG

    let activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
    let winHistory = winHistoryStr ? JSON.parse(winHistoryStr) : [];
    let wallet = walletConfigStr ? JSON.parse(walletConfigStr) : {
        initialBalance: 1000, currentBalance: 1000, riskPercentage: 10, allocatedCapital: 500,
        tradingMode: mode, isBotActive: true, maxTrades: 3, dailyLossLimit: 50, cooldownMinutes: 30,
        strategyConfig: { SNIPER: { active: true }, HYBRID_SWING: { active: true } }
    };

    const strategiesRaw = wallet.strategyConfig || { SNIPER: { active: true } };
    const activeStrategies = Object.keys(strategiesRaw).filter(k => strategiesRaw[k].active);
    const strategiesStr = activeStrategies.length > 0 ? activeStrategies.join(' + ') : (wallet.strategy || 'SWING');

    const activeColor = mode === 'LIVE' ? '🔴' : '🔵';
    console.log(`${activeColor} [${mode}] STRATEGY: ${strategiesStr} | Active: ${activeTrades.length} | Balance: $${wallet.currentBalance.toFixed(0)}`);

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

                    // FETCH SNIPER TRADES TO AVOID DOUBLE MANAGEMENT
                    // If the Sniper is managing a trade (e.g. BTC), the Scanner must NOT adopt it.
                    let activeSniperTrades = [];
                    try {
                        const sStr = await redis.get('sentinel_sniper_trades');
                        activeSniperTrades = sStr ? JSON.parse(sStr) : [];
                    } catch (e) {
                        console.warn('⚠️ Failed to fetch sniper trades during sync check');
                    }

                    // Convert to trade objects so the bot can Manage them (SL/TP)
                    const syncedTrades = (await Promise.all(positions.map(async (pos) => {
                        const symbol = `${pos.asset}USDT`;

                        // 🔍 CHECK 1: IS THIS A SNIPER TRADE?
                        // We only care about LIVE sniper trades matching this symbol
                        const isSniperManaged = activeSniperTrades.find(t => t.symbol === symbol && t.mode === 'LIVE');
                        if (isSniperManaged) {
                            console.log(`[LIVE] 🔫 Ignoring ${symbol} (Managed by SNIPER Worker).`);
                            return null;
                        }

                        // 🛡️ CHECK 2: ZOMBIE PROTECTION
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
                    }))).filter(t => t !== null); // Remove nulls (dust or sniper)

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

    // --- GOD-MODE: PARALLEL PROCESSING ENGINE ---

    // 1. MONITOR ACTIVE TRADES (Parallel)
    // We monitor the originally active trades
    const monitorPromises = activeTrades.map(async (trade) => {
        try {
            const symbol = trade.symbol;
            const marketData = await fetchGlobalPrice(symbol, marketCache);
            if (!marketData || !marketData.price) return { status: 'KEEP', trade };

            const currentPrice = marketData.price;
            const currentBid = marketData.bid;
            const currentAsk = marketData.ask;

            let exitPrice = trade.type === 'SHORT' ? currentAsk : currentBid;
            let pnl = trade.type === 'SHORT' ? ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100 : ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;

            // LOG MONITORING
            console.log(`.. [${mode}] 👁️ MON: ${symbol} | PnL: ${pnl.toFixed(2)}% | SL: -${(wallet.stopLoss || 3.0)}%`);

            let isExit = false;
            const effectiveSL = wallet.stopLoss || 3.0;

            if (pnl <= -effectiveSL) {
                console.log(`[${mode}] 🛑 STOP LOSS TRIGGERED for ${symbol} @ ${pnl.toFixed(2)}%`);
                isExit = true;
            }
            if (pnl >= (wallet.takeProfit || 1.5)) isExit = true;

            if (isExit) {
                const qty = trade.quantity || (trade.investedAmount / trade.entryPrice);
                console.log(`[${mode}] 📉 CLOSING POSITION: ${symbol} ...`);

                // EXECUTE SELL
                const order = await binanceClient.executeOrder(symbol, 'SELL', qty, currentPrice, 'MARKET', mode === 'LIVE');
                const received = parseFloat(order.cummulativeQuoteQty);
                const fee = received * 0.001;
                const netProfit = received - trade.investedAmount - (trade.entryFee || 0) - fee;
                const finalPnl = (netProfit / trade.investedAmount) * 100;

                if (mode === 'SIMULATION') wallet.currentBalance += (received - fee);

                const win = { symbol, pnl: finalPnl, profitUsd: netProfit, timestamp: new Date().toISOString(), strategy: trade.strategy, mode: mode };
                await sendRawTelegram(`🚨 **[${mode}] TRADE CLOSED: ${symbol}**\n📉 ROI: ${finalPnl.toFixed(2)}%\n💰 Profit: $${netProfit.toFixed(2)}`);

                return { status: 'CLOSED', win };
            }

            return { status: 'KEEP', trade };
        } catch (e) {
            console.error(`[${mode}] Error monitoring ${trade.symbol}:`, e.message);
            return { status: 'KEEP', trade };
        }
    });

    const monitorResults = await Promise.all(monitorPromises);

    // Extract Results
    const keptTrades = monitorResults.filter(r => r.status === 'KEEP').map(r => r.trade);
    const roundWins = monitorResults.filter(r => r.status === 'CLOSED').map(r => r.win);
    newWins.push(...roundWins);

    // Capture Manual Trades added in this cycle (preserving them)
    const manualAddedTrades = newActiveTrades.filter(t => !activeTrades.find(old => old.id === t.id));

    // 2. SCAN NEW OPPORTUNITIES (Parallel)
    const maxTrades = wallet.maxTrades || 3;
    const currentTotal = keptTrades.length + manualAddedTrades.length;
    let newFoundTrades = [];

    if (currentTotal < maxTrades) {
        // Identify Candidates (Symbols in marketPairs NOT in keptTrades OR manualAdded)
        const occupiedSymbols = [...keptTrades, ...manualAddedTrades].map(t => t.symbol);
        const candidates = marketPairs.filter(s => !occupiedSymbols.includes(s));

        const scanPromises = candidates.map(async (symbol) => {
            try {
                const strategiesRaw = wallet.strategyConfig || { SNIPER: { active: true } };
                const activeStrategies = Object.keys(strategiesRaw).filter(k => strategiesRaw[k].active);
                if (activeStrategies.length === 0) activeStrategies.push(wallet.strategy || 'SWING');

                for (const strat of activeStrategies) {
                    if (strat === 'SNIPER') continue;

                    let interval = '4h';
                    let analysisMode = 'SWING';
                    let useHybrid = false;

                    if (strat.includes('BLITZ')) { interval = '5m'; analysisMode = 'BLITZ'; useHybrid = true; }
                    else if (strat.includes('HYBRID') || strat.includes('SWING')) { interval = '4h'; analysisMode = 'SWING'; useHybrid = true; }

                    const candles = await fetchGlobalKlines(symbol, interval, 60);
                    if (!candles || candles.length < 30) continue;

                    let result;
                    if (useHybrid) result = analysis.analyzeOB(candles, { mode: analysisMode });
                    else result = analysis.analyzePair(candles, { swingMode: 'AGGRESSIVE', mode: analysisMode });

                    const signal = result.prediction?.signal;
                    const intensity = result.prediction?.intensity || 0;

                    if (intensity > 60) {
                        const emoji = signal.includes('BUY') ? '🟢' : '🔴';
                        console.log(`   [${mode}] ${symbol} [${strat}]: ${emoji} ${signal} (${intensity}%)`);
                    }

                    let enter = false;
                    if (analysisMode === 'BLITZ') {
                        if (signal === 'BUY' || signal === 'STRONG_BUY') enter = true;
                    } else {
                        if (signal === 'STRONG_BUY' || (signal === 'BUY' && intensity >= 80)) enter = true;
                    }

                    if (enter) {
                        console.log(`🚀 [${mode}] AUTO-SIGNAL: ${symbol} (${signal} - ${intensity}%)`);

                        const risk = wallet.riskPercentage || 10;
                        const balance = wallet.currentBalance || 0;
                        const amountToInvest = (balance * (risk / 100));

                        if (amountToInvest > 10) {
                            const pd = await fetchGlobalPrice(symbol, marketCache);
                            const buyPrice = pd?.price;
                            if (!buyPrice) continue;

                            let executionPrice = buyPrice;
                            let executedQty = amountToInvest / buyPrice;
                            let actualSpent = amountToInvest;
                            let success = true;

                            if (mode === 'LIVE') {
                                const order = await binanceClient.executeOrder(symbol, 'BUY', amountToInvest, buyPrice, 'MARKET', true);
                                executedQty = parseFloat(order.executedQty);
                                actualSpent = parseFloat(order.cummulativeQuoteQty);
                                executionPrice = actualSpent / executedQty;
                            } else {
                                wallet.currentBalance -= (amountToInvest * 1.001);
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
                                    strategy: strat,
                                    mode: mode,
                                    isManual: false,
                                    takeProfit: result.obZone?.tp || null,
                                    stopLoss: result.obZone?.sl || null
                                };
                                await sendRawTelegram(`🤖 **[${mode}] AUTO ENTRY**\n🚀 **${symbol}**\n🔧 Strat: ${strat}\n💰 Entry: $${executionPrice.toFixed(4)}`);
                                return newTrade;
                            }
                        }
                    }
                }
            } catch (scanErr) { }
            return null;
        });

        const found = await Promise.all(scanPromises);
        newFoundTrades = found.filter(t => t !== null);
    }

    // CONSTRUCT FINAL STATE (Preserving Const Reference)
    const finalList = [...keptTrades, ...manualAddedTrades];

    // Add new found trades safely (checking maxTrades again just in case)
    for (const t of newFoundTrades) {
        if (finalList.length < maxTrades) {
            finalList.push(t);
        }
    }

    // Mutate the const array in place
    newActiveTrades.splice(0, newActiveTrades.length, ...finalList);

    // --- STATE INTEGRITY GUARD (Merge-Before-Commit) ---
    // Prevent overwriting manual actions that happened during the scan (Race Condition Fix)
    const finalFreshStateStr = await redis.get(activeKey);
    const finalFreshState = finalFreshStateStr ? JSON.parse(finalFreshStateStr) : [];

    // 1. Detect External Adds (Manual Buys or Sniper Triggers while we were scanning)
    const externallyAdded = finalFreshState.filter(freshT => !activeTrades.find(localT => localT.id === freshT.id));

    // 2. Detect External Deletes (Manual Sells or Stop Losses while we were scanning)
    // If a trade was in our 'activeTrades' at start (snapshot) but is GONE from 'finalFreshState',
    // it means it was deleted externally. We must NOT save it back.
    // However, 'newActiveTrades' is our *proposed* next state.
    // We need to filter 'newActiveTrades' to strictly exclude things that are missing from fresh state 
    // UNLESS they are brand new trades we just generated ourselves in this cycle.

    // A. Identify IDs that existed at start of this cycle
    const snapshotIds = activeTrades.map(t => t.id);

    // B. Filter our proposed state
    const mergedActiveTrades = newActiveTrades.filter(proposedT => {
        // Condition 1: It's a brand new trade we just made (ID not in snapshot) -> KEEP IT
        if (!snapshotIds.includes(proposedT.id)) return true;

        // Condition 2: It's an old trade. Does it still exist in Redis?
        // If yes -> KEEP IT. If no (someone deleted it) -> DROP IT.
        const stillExisteInRedis = finalFreshState.find(f => f.id === proposedT.id);
        return !!stillExisteInRedis;
    });

    // C. Add the external additions
    const finalState = [...mergedActiveTrades, ...externallyAdded];

    // Log if intervention occurred
    if (finalState.length !== newActiveTrades.length) {
        console.log(`🛡️ [INTEGRITY GUARD] Race Condition Prevented! Merged ${externallyAdded.length} new & removed ${newActiveTrades.length - mergedActiveTrades.length} stale trades.`);
    }

    // GOD-MODE OPTIMIZATION: Pipeline Writes (Atomic & Fast)
    const pipeline = redis.pipeline();
    pipeline.set(activeKey, JSON.stringify(finalState));
    pipeline.set(configKey, JSON.stringify(wallet));

    if (newWins.length > 0) {
        // Optimization: Use 'winHistory' fetched at start (via mget) instead of fetching again
        const updatedHistory = [...newWins, ...winHistory].slice(0, 50);
        pipeline.set(historyKey, JSON.stringify(updatedHistory));
    }

    await pipeline.exec();
    return { mode, activeCount: finalState.length, alerts: [] };
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
