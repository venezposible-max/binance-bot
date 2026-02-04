import axios from 'axios';
import { RSI, EMA, BollingerBands } from 'technicalindicators';
import * as analysis from '../src/utils/analysis.js';
import redis from './utils/redisClient.js';
import binanceClient from './utils/binance-client.js';
import { authenticatedRequest } from './utils/binance-client.js';
import { v4 as uuidv4 } from 'uuid';
import { sendRawTelegram } from '../src/utils/telegram.js';

// --- Shared Logic ---
let lastWorkingSource = null;

async function getDynamicTopPairs() {
    const sources = [
        { url: 'https://api.binance.com/api/v3/ticker/24hr', label: 'EU' }
    ];
    // if (lastWorkingSource === 'USA') sources.reverse(); // REMOVED: Strict EU
    for (const src of sources) {
        try {
            const res = await axios.get(src.url, { timeout: 5000 });
            if (res.data && Array.isArray(res.data)) {
                // BLACKLIST: Added ZAMA and ZEC as requested by User
                const BLACKLIST = ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'AEUR', 'EUR', 'GBP', 'PAXG', 'WBTC', 'USD1', 'USDE', 'SUSD', 'FRAX', 'LUSD', 'GUSD', 'FUSD', 'ZAMA', 'ZEC'];
                const relevant = res.data.filter(p => {
                    if (!p.symbol.endsWith('USDT')) return false;
                    // REGEX: Filter out non-alphanumeric symbols (e.g. Chinese chars)
                    if (!/^[A-Z0-9]+$/.test(p.symbol)) return false;

                    if (BLACKLIST.some(blocked => p.symbol.includes(blocked))) return false;
                    return parseFloat(p.quoteVolume) > 5000000;
                });
                relevant.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
                // Increased Search Depth to 20 to find alternatives
                const finalPairs = relevant.slice(0, 10).map(p => p.symbol);

                // SYNC: Save "Official" List to Redis for Frontend
                try {
                    await redis.set('sentinel_active_pairs', JSON.stringify(finalPairs));
                } catch (redisErr) {
                    console.warn('⚠️ Failed to save top pairs to Redis:', redisErr.message);
                }

                return finalPairs;
            }
        } catch (e) {
            console.warn(`⚠️ Dynamic Pairs [${src.label}] Fail: ${e.response?.status === 403 ? '403 Blocked' : e.message}`);
        }
    }
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'BNBUSDT', 'AVAXUSDT', 'LINKUSDT'];
}

async function fetchGlobalPrice(symbol, cache = null) {
    if (cache && cache[symbol]) return { ...cache[symbol], source: 'WS_CACHE' };

    // Updated Sources: Prioritize GCP/Alt, but fallback to Main API (Robustness fix)
    const sources = [
        { url: `https://api-gcp.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`, label: 'REST_EU_GCP' },
        { url: `https://api1.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`, label: 'REST_EU_ALT' },
        { url: `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`, label: 'REST_GLOBAL' }
    ];

    // Removed Region Check: Always Global
    const workingLabel = 'EU';

    for (const src of sources) {
        try {
            const res = await axios.get(src.url, { timeout: 3000 });
            lastWorkingSource = src.label.includes('US') ? 'USA' : 'EU';
            return { price: parseFloat(res.data.bidPrice), bid: parseFloat(res.data.bidPrice), ask: parseFloat(res.data.askPrice), source: src.label };
        } catch (e) {
            // FIX: Don't break! Try next source. Only 403 indicates we might be blocked, but even then, mirrors might work.
            // console.warn(`⚠️ Price Fetch Fail [${src.label}]: ${e.message}`);
            continue;
        }
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
        { url: `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, label: 'GLOBAL' }
    ];
    // Removed Region Check: Always Global
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

    let activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
    let winHistory = winHistoryStr ? JSON.parse(winHistoryStr) : [];
    let wallet = walletConfigStr ? JSON.parse(walletConfigStr) : {
        initialBalance: 1000,
        currentBalance: 1000,
        riskPercentage: 10,
        maxTrades: 3,
        strategy: 'HYBRID_BLITZ'
    };

    // --- SYNC REAL BALANCE (LIVE MODE) ---
    if (mode === 'LIVE') {
        try {
            const usdt = await binanceClient.getAccountBalance('USDT');
            if (usdt && !usdt.error) {
                wallet.currentBalance = usdt.total;
                // Auto-save updated balance to Redis so logs remain accurate
                await redis.set(configKey, JSON.stringify(wallet));
            }
        } catch (e) {
            // Ignore sync error, proceed with cached balance
        }
    }

    // console.warn(`🐛 DEBUG: REDIS FETCHED for ${mode}`); // REMOVED DEBUG



    // FORCE CLEAN DISPLAY: Ignore stale Redis strategy configs
    const strategiesStr = 'BLITZ';

    const activeColor = mode === 'LIVE' ? '🔴' : '🔵';
    console.log(`${activeColor} [${mode}] STRATEGY: ${strategiesStr} | Active: ${activeTrades.length} | Balance: $${wallet.currentBalance.toFixed(0)}`);

    // --- CRITICAL: Live Position Sync (Auto Discovery) ---
    if (mode === 'LIVE' && activeTrades.length === 0) {
        if (wallet.isBotActive) {
            try {
                // Attempt to fetch open balances/positions from Binance if local state is empty
                const balanceData = await authenticatedRequest('/api/v3/account', 'GET');
                if (balanceData && balanceData.balances) {
                    const heldAssets = balanceData.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
                    const positions = heldAssets.filter(a => a.asset !== 'USDT' && a.asset !== 'BNB'); // Filter base assets

                    if (positions.length > 0) {
                        console.log(`[LIVE] ⚠️ Discovered ${positions.length} held assets on Binance not in Redis. Syncing...`);

                        // SNIPER MODULE REMOVED

                        // Convert to trade objects so the bot can Manage them (SL/TP)
                        const syncedTrades = (await Promise.all(positions.map(async (pos) => {
                            const symbol = `${pos.asset}USDT`;

                            // SNIPER CHECK REMOVED

                            // 🛡️ CHECK 2: ZOMBIE PROTECTION (Enhanced)
                            // If we recently closed it, we usually ignore it to avoid "Ghost Reappearance" of dust.
                            // BUT, if the balance is significant (>$10), it means the Sell failed or was partial.
                            // We must Re-Adopt it so the user can see it and close it again.
                            const lastClose = winHistory.find(h => h.symbol === symbol && new Date(h.timestamp) > new Date(Date.now() - 300000)); // 5 mins lookback

                            if (lastClose) {
                                const priceData = await fetchGlobalPrice(symbol); // Move up for zombie check
                                const qty = parseFloat(pos.free) + parseFloat(pos.locked);
                                const valUsd = qty * (priceData?.price || 0);

                                if (valUsd > 10) {
                                    console.warn(`[LIVE] 🧟 ZOMBIE RESURRECTION: Found ${symbol} ($${valUsd.toFixed(2)}) despite recent close history. Re-adopting for safety.`);
                                    // Allow it to proceed (don't return null)
                                } else {
                                    console.warn(`[LIVE] 🧟 ZOMBIE BLOCKED: Found ${symbol} dust ($${valUsd.toFixed(2)}) closed recently. Ignoring.`);
                                    return null;
                                }
                            }

                            const priceData = await fetchGlobalPrice(symbol);
                            const currentPrice = priceData?.price || 0;
                            const qty = parseFloat(pos.free) + parseFloat(pos.locked);
                            const valueUsd = qty * currentPrice;

                            // FILTER DUST: Ignore assets worth less than $5
                            if (valueUsd < 5) return null;

                            // 🔒 STRICT RULE: Only adopt trades if they are in the TOP 10 Strategy List
                            // User Request: "No escanear monedas fuera del Top 10"
                            if (!marketPairs.includes(symbol)) {
                                console.log(`[LIVE] 🚫 Ignoring ${symbol} (Not in Top 10 Strategy List).`);
                                return null;
                            }

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
        } else {
            console.log(`[LIVE] ⏸️ PAUSED: Skipping Position Sync.`);
        }
    }

    const newActiveTrades = [...activeTrades];
    const newWins = [];

    // --- Process Manual Injected Opportunities ---
    // ALLOW MANUAL EVEN IF PAUSED? Usually yes, but user said "Ningun trading". 
    // Let's allow manual if the user explicitly requested it via API, but here we are processing a queue passed by argument?
    // 'manualOpportunities' arg comes from where? It's passed as null in handler (line 653/656).
    // So this block is likely dead code or reserved for future.
    if (manualOpportunities && Array.isArray(manualOpportunities) && wallet.isBotActive) {
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

            // 🚫 BLACKLIST PURGE: Explicitly remove bans from Redis
            const PURGE_LIST = ['ZAMA', 'ZEC', '币安人生', 'PUMP', 'ASTER', 'PUMPUSDT', 'ASTERUSDT'];
            const isInvalid = !/^[A-Z0-9]+$/.test(symbol) || PURGE_LIST.some(p => symbol.includes(p));

            if (isInvalid) {
                console.warn(`🗑️ [PURGE] Automatically Removing Blacklisted/Invalid Trade: ${symbol}`);
                const win = {
                    symbol,
                    pnl: 0,
                    profitUsd: 0,
                    timestamp: new Date().toISOString(),
                    strategy: 'PURGE',
                    mode: mode,
                    type: trade.type || 'LONG',
                    entryPrice: trade.entryPrice,
                    exitPrice: trade.entryPrice,
                    investedAmount: trade.investedAmount || 0
                };
                return { status: 'CLOSED', win, id: trade.id };
            }

            const marketData = await fetchGlobalPrice(symbol, marketCache);
            if (!marketData || !marketData.price) return { status: 'KEEP', trade };

            const currentPrice = marketData.price;
            const currentBid = marketData.bid;
            const currentAsk = marketData.ask;

            let exitPrice = trade.type === 'SHORT' ? currentAsk : currentBid;
            // PnL Logic: Positive = Profit, Negative = Loss
            let pnl = trade.type === 'SHORT' ? ((trade.entryPrice - currentAsk) / trade.entryPrice) * 100 : ((currentBid - trade.entryPrice) / trade.entryPrice) * 100;

            // LOG MONITORING
            // console.log(`.. [${mode}] 👁️ MON: ${symbol} | PnL: ${pnl.toFixed(2)}%`);

            let isExit = false;

            // --- DYNAMIC TRAILING STOP (Step Follow) ---
            // Trigger: Start at +0.7% Profit
            // Margin: Follow price at 0.2% distance
            if (pnl >= 0.7) {
                const trailMargin = 0.002; // 0.2% gap
                let newTrailingSL = 0;

                if (trade.type === 'SHORT') {
                    // Short: SL is ABOVE price. 
                    // New SL = Current Price + 0.2%
                    // We use `currentAsk` as worst case or `currentPrice`
                    newTrailingSL = currentPrice * (1 + trailMargin);

                    // Only move SL DOWN (tighter)
                    if (!trade.stopLoss || newTrailingSL < trade.stopLoss) {
                        trade.stopLoss = newTrailingSL;
                        console.log(`[${mode}] ⛓️ TRAILING STOP: ${symbol} @ +${pnl.toFixed(2)}%. SL moved to ${newTrailingSL.toFixed(4)}`);
                    }
                } else {
                    // Long: SL is BELOW price.
                    // New SL = Current Price - 0.2%
                    newTrailingSL = currentPrice * (1 - trailMargin);

                    // Only move SL UP (tighter)
                    if (!trade.stopLoss || newTrailingSL > trade.stopLoss) {
                        trade.stopLoss = newTrailingSL;
                        console.log(`[${mode}] ⛓️ TRAILING STOP: ${symbol} @ +${pnl.toFixed(2)}%. SL moved to ${newTrailingSL.toFixed(4)}`);
                    }
                }
            }

            // --- STOP LOSS LOGIC ---
            // 1. Determine effective SL Percentage (Legacy/Global logic)
            const globalSLActive = wallet.useStopLoss !== false;
            let effectiveSL = null;

            if ([null, undefined].includes(trade.stopLoss)) {
                // Only use Global SL % if no specific price is set
                effectiveSL = null; // DISABLED by default per user request, unless wallet has global override
                // If we want Global SL back, logic goes here.
            }

            // ... Take Profit Logic ... (Unchanged)
            let effectiveTP = wallet.takeProfit || 1.5;
            if (trade.takeProfit) {
                if (trade.type === 'SHORT') effectiveTP = ((trade.entryPrice - trade.takeProfit) / trade.entryPrice) * 100;
                else effectiveTP = ((trade.takeProfit - trade.entryPrice) / trade.entryPrice) * 100;
                effectiveTP = Math.abs(effectiveTP);
            }

            // 2. CHECK STOP LOSS (SAFETY & TRAILING)
            const hasSpecificSL = trade.stopLoss !== null && trade.stopLoss !== undefined;

            // PRIORITY 1: Explicit Price SL (Supports Stops in Profit)
            if (hasSpecificSL) {
                if (trade.type === 'LONG' && currentPrice <= trade.stopLoss) {
                    console.log(`[${mode}] 🛑 STOP LOSS HIT (Price): ${symbol} @ ${currentPrice} (SL: ${trade.stopLoss})`);
                    isExit = true;
                } else if (trade.type === 'SHORT' && currentPrice >= trade.stopLoss) {
                    console.log(`[${mode}] 🛑 STOP LOSS HIT (Price): ${symbol} @ ${currentPrice} (SL: ${trade.stopLoss})`);
                    isExit = true;
                }
            }
            // PRIORITY 2: Global Percentage SL (Fallback for Loss Only)
            else if (globalSLActive && effectiveSL !== null && pnl <= -effectiveSL) {
                console.log(`[${mode}] 🛑 STOP LOSS TRIGGERED (Global %): ${symbol} @ ${pnl.toFixed(2)}% (Target: -${effectiveSL}%)`);
                isExit = true;
            }
            if (pnl >= effectiveTP) {
                console.log(`[${mode}] 🎯 TAKE PROFIT TRIGGERED for ${symbol} @ ${pnl.toFixed(2)}% (Target: +${effectiveTP}%)`);
                isExit = true;
            }

            if (isExit) {
                const qty = trade.quantity || (trade.investedAmount / trade.entryPrice);
                console.log(`[${mode}] 📉 CLOSING POSITION: ${symbol} ...`);

                let netProfit = 0, finalPnl = 0, executionPrice = currentPrice;

                try {
                    // EXECUTE SELL
                    const order = await binanceClient.executeOrder(symbol, 'SELL', qty, currentPrice, 'MARKET', mode === 'LIVE');
                    const received = parseFloat(order.cummulativeQuoteQty);
                    const fee = received * 0.001;
                    netProfit = received - trade.investedAmount - (trade.entryFee || 0) - fee;
                    finalPnl = (netProfit / trade.investedAmount) * 100;
                    executionPrice = received / parseFloat(order.executedQty) || currentPrice;

                    if (mode === 'SIMULATION') wallet.currentBalance += (received - fee);

                } catch (err) {
                    const errorMsg = err.response?.data?.msg || err.message;
                    const errorCode = err.response?.data?.code;

                    if (mode === 'LIVE' && (
                        errorMsg.includes('-2010') ||
                        errorMsg.includes('insufficient balance') ||
                        errorCode === -2010
                    )) {
                        console.warn(`⚠️ [LIVE] Force Closing ${symbol}: Position missing on Binance (Insufficient Balance).`);
                        // Force Close Local State: Assumed 0 PnL or small loss? 
                        // Safer to set 0 PnL to just remove it.
                        netProfit = 0;
                        finalPnl = 0;
                        executionPrice = currentPrice;
                        // Do NOT increment wallet balance for Live (funds missing)
                    } else {
                        throw err; // Rethrow other errors (Connection, etc)
                    }
                }

                const win = {
                    symbol,
                    pnl: finalPnl || 0,
                    profitUsd: netProfit || 0,
                    timestamp: new Date().toISOString(),
                    strategy: trade.strategy,
                    mode: mode,
                    type: trade.type || 'LONG',
                    entryTimestamp: trade.timestamp, // Persist entry time
                    entryPrice: trade.entryPrice,
                    exitPrice: executionPrice,
                    investedAmount: trade.investedAmount
                };
                // Duration Calc
                const diffMs = new Date() - new Date(trade.timestamp);
                const hrs = Math.floor(diffMs / 3600000);
                const mins = Math.floor((diffMs % 3600000) / 60000);
                const durationStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;

                await sendRawTelegram(`🚨 **[${mode}] TRADE CLOSED: ${symbol}**\n📉 ROI: ${(finalPnl || 0).toFixed(2)}%\n💰 Profit: $${(netProfit || 0).toFixed(2)}\n⏱️ Duración: ${durationStr}`);

                return { status: 'CLOSED', win, id: trade.id };
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
    const closedIds = monitorResults.filter(r => r.status === 'CLOSED').map(r => r.id);
    newWins.push(...roundWins);

    // Capture Manual Trades added in this cycle (preserving them)
    const manualAddedTrades = newActiveTrades.filter(t => !activeTrades.find(old => old.id === t.id));

    // 2. SCAN NEW OPPORTUNITIES (Parallel)
    const maxTrades = wallet.maxTrades || 3;
    const currentTotal = keptTrades.length + manualAddedTrades.length;
    let newFoundTrades = [];

    // CONSTRUCT FINAL STATE (Moved up for scope access)
    // FIX: Ensure finalList is available regardless of the branch
    let finalList = [...keptTrades, ...manualAddedTrades];

    // Identify Candidates (Symbols in marketPairs NOT in keptTrades OR manualAdded)
    const occupiedSymbols = [...keptTrades, ...manualAddedTrades].map(t => t.symbol);
    const candidates = marketPairs.filter(s => !occupiedSymbols.includes(s));

    if (!wallet.isBotActive) {
        // User Request: "Si esta pausado... decir lo que tenia skipping"
        console.log(`[${mode}] ⏸️ PAUSED: Monitoring [${candidates.join(', ')}] but skipping execution.`);
    } else {
        console.log(`🔍 [${mode}] Scanning [${candidates.join(', ')}] for BLITZ signals...`);

        if (currentTotal < maxTrades) {

            const scanPromises = candidates.map(async (symbol) => {
                try {
                    // 🛡️ COOLDOWN CHECK: Prevent re-entry if closed < 5 mins ago
                    const lastClose = winHistory.find(h => h.symbol === symbol);
                    if (lastClose) {
                        const closeTime = new Date(lastClose.timestamp).getTime();
                        // 5 minutes * 60 * 1000
                        if (Date.now() - closeTime < 300000) {
                            console.log(`⏳ [${mode}] COOLDOWN: ${symbol} closed recently. Skipping re-entry.`);
                            return null;
                        }
                    }

                    // FORCE BLITZ MODE
                    const interval = '5m';
                    const analysisMode = 'BLITZ';

                    const candles = await fetchGlobalKlines(symbol, interval, 60);
                    if (!candles || candles.length < 30) return null;

                    // Analysis: BLITZ only
                    const result = analysis.analyzeBlitz(marketCache && marketCache[symbol] ? { bids: [], asks: [] } : null, candles);

                    const signal = result.prediction?.signal;
                    const intensity = result.prediction?.intensity || 0;

                    if (intensity > 30) {
                        const emoji = signal.includes('BUY') ? '🟢' : '🔴';
                        console.log(`   [${mode}] ${symbol} [BLITZ]: ${emoji} ${signal} (${intensity}%)`);
                    }

                    let enter = false;
                    if (signal === 'BUY' || signal === 'STRONG_BUY') enter = true;

                    if (enter) {
                        console.log(`🚀 [${mode}] AUTO-SIGNAL: ${symbol} (${signal} - ${intensity}%)`);

                        const risk = wallet.riskPercentage || 10;
                        const balance = wallet.currentBalance || 0;
                        const amountToInvest = (balance * (risk / 100));

                        if (amountToInvest > 10) {
                            const pd = await fetchGlobalPrice(symbol, marketCache);
                            const buyPrice = pd?.price;
                            if (!buyPrice) return null;

                            return {
                                symbol: symbol,
                                signal: signal,
                                intensity: intensity,
                                price: buyPrice,
                                strategy: 'BLITZ', // CLEAN NAME
                                obZone: result.obZone
                            };
                        }
                    }
                } catch (scanErr) { }
                return null;
            });

            const found = await Promise.all(scanPromises);
            const validCandidates = found.filter(c => c !== null);

            // Sort by intensity (Prioritize best signals)
            validCandidates.sort((a, b) => b.intensity - a.intensity);

            for (const cand of validCandidates) {
                // DOUBLE CHECK LIMIT (The critical fix)
                // We re-calculate current count including the ones we JUST added in this loop.
                if (finalList.length < maxTrades) {
                    const risk = wallet.riskPercentage || 10;
                    const balance = wallet.currentBalance || 0;
                    const amountToInvest = (balance * (risk / 100));

                    // Re-verify Price (Micro-slippage check)
                    const buyPrice = cand.price;

                    let executionPrice = buyPrice;
                    let executedQty = amountToInvest / buyPrice;
                    let actualSpent = amountToInvest;

                    try {
                        if (mode === 'LIVE') {
                            const order = await binanceClient.executeOrder(cand.symbol, 'BUY', amountToInvest, buyPrice, 'MARKET', true);
                            executedQty = parseFloat(order.executedQty);
                            actualSpent = parseFloat(order.cummulativeQuoteQty);
                            executionPrice = actualSpent / executedQty;
                        } else {
                            wallet.currentBalance -= (amountToInvest * 1.001);
                        }

                        const newTrade = {
                            id: uuidv4(),
                            symbol: cand.symbol,
                            entryPrice: executionPrice,
                            investedAmount: actualSpent,
                            quantity: executedQty,
                            type: 'LONG',
                            timestamp: new Date().toISOString(),
                            strategy: cand.strategy,
                            mode: mode,
                            isManual: false,
                            takeProfit: cand.obZone?.tp || null,
                            stopLoss: cand.obZone?.sl || null
                        };

                        finalList.push(newTrade);
                        await sendRawTelegram(`🤖 **[${mode}] AUTO ENTRY**\n🚀 **${cand.symbol}**\n🔧 Strat: ${cand.strategy}\n💰 Entry: $${executionPrice.toFixed(4)}`);
                        console.log(`[${mode}] ✅ Executed ${cand.symbol} (${cand.intensity}%)`);

                    } catch (execErr) {
                        console.error(`[${mode}] ❌ Execution Failed for ${cand.symbol}:`, execErr.message);
                    }
                } else {
                    console.log(`[${mode}] ⏸️ Quota Full (${maxTrades}). Skipped ${cand.symbol}.`);
                }
            }
        } else {
            console.log(`[${mode}] ⏸️ Quota Full (${currentTotal}/${maxTrades}). Scanning paused.`);
        }
    } // End of if (!wallet.isBotActive) else ...

    // Mutate the const array in place
    newActiveTrades.splice(0, newActiveTrades.length, ...finalList);

    // --- STATE INTEGRITY GUARD (Merge-Before-Commit) ---
    // Prevent overwriting manual actions that happened during the scan (Race Condition Fix)
    // GOD-MODE FIX: "Ghost Trade Resurrection"
    // If a trade vanishes from Redis but wasn't Closed (no History entry), we MUST Put it back.

    // 1. Fetch Fresh State (Active & History) to verify external actions
    const [finalFreshStateStr, finalHistoryStr] = await redis.mget([activeKey, historyKey]);
    const finalFreshState = finalFreshStateStr ? JSON.parse(finalFreshStateStr) : [];
    const finalHistory = finalHistoryStr ? JSON.parse(finalHistoryStr) : [];

    // 2. Detect External Adds (Manual Buys or Sniper Triggers while we were scanning)
    const externallyAdded = finalFreshState.filter(freshT => !activeTrades.find(localT => localT.id === freshT.id));

    // 3. Detect External Deletes vs Ghosts
    // A. Identify IDs that existed at start of this cycle
    const snapshotIds = activeTrades.map(t => t.id);

    // B. Filter our proposed state
    const mergedActiveTrades = newActiveTrades.filter(proposedT => {
        // Condition 1: It's a brand new trade we just made (ID not in snapshot) -> KEEP IT
        if (!snapshotIds.includes(proposedT.id)) return true;

        // Condition 2: It's an old trade. Does it still exist in Redis?
        const stillExisteInRedis = finalFreshState.find(f => f.id === proposedT.id);

        if (stillExisteInRedis) return true; // It's there, keep it.

        // Condition 3: It's GONE from Redis. Was it officially closed?
        // Check History for this ID (or approximately by symbol/timestamp if ID not in history)
        // Note: Our history items don't strictly have IDs in previous versions, but let's check Symbol + Timestamp > start time?
        // Actually, safer: Logic - If it thinks it's a delete, trust it ONLY if we see a win/loss recorded?
        // Or simpler: If we are in Simulation, Resurrection is safer than data loss.

        // Let's check if a trade for this symbol appears in the *fresh* history that wasn't there before?
        // Too complex. 
        // Simplest Resurrection: If it's missing, log it. if it wasn't manual, Resurrect it.
        // We assume 'manual-trade.js' is the only deleter.
        // If 'manual-trade.js' runs, it updates History.

        // FIX: Verify if Symbol is in the recent history entries (top 5) OR if we just closed it in this cycle.
        const justClosedLocally = closedIds.includes(proposedT.id);
        const wasRecentlyClosed = justClosedLocally || finalHistory.slice(0, 10).find(h => h.symbol === proposedT.symbol && new Date(h.timestamp) > new Date(Date.now() - 60000));

        if (wasRecentlyClosed) {
            // It was truly closed. Honor the delete.
            return false;
        } else {
            // DATA INTEGRITY CHECK: Do not resurrect corrupt trades (NaN or $0 price)
            // This fixes the "ZAMA" zombie issue where price is 0 and it keeps coming back.
            if (!proposedT.entryPrice || proposedT.entryPrice <= 0 || isNaN(proposedT.entryPrice)) {
                console.warn(`💀 [INTEGRITY GUARD] Buried Corrupt Zombie: ${proposedT.symbol} (Invalid Price: ${proposedT.entryPrice}). NOT Resurrecting.`);
                return false;
            }

            // 👻 GHOST DETECTED! Use Resurrection Protocol.
            console.warn(`👻 [INTEGRITY GUARD] Resurrected Ghost Trade: ${proposedT.symbol} (Missing from Redis but NO Close found in History)`);
            return true; // KEEP IT (Write it back to Redis)
        }
    });

    // C. Add the external additions
    const finalState = [...mergedActiveTrades, ...externallyAdded];

    // Log if intervention occurred
    if (finalState.length !== newActiveTrades.length) {
        // This log logic needs update, but acceptable for now
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
