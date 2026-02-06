
import axios from 'axios';
import { RSI, EMA, BollingerBands } from 'technicalindicators';
import * as analysis from '../src/utils/analysis.js';
import redis from './utils/redisClient.js';
import binanceClient from './utils/binance-client.js';
import { authenticatedRequest } from './utils/binance-client.js';
import { v4 as uuidv4 } from 'uuid';
import { sendRawTelegram } from '../src/utils/telegram.js';
import { runWithLock } from './utils/locker.js';

// --- Shared Logic ---
let lastWorkingSource = null;

async function getDynamicTopPairs() {
    const sources = [
        { url: 'https://api.binance.com/api/v3/ticker/24hr', label: 'EU' }
    ];
    for (const src of sources) {
        try {
            const res = await axios.get(src.url, { timeout: 5000 });
            if (res.data && Array.isArray(res.data)) {
                // BLACKLIST
                const BLACKLIST = ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'AEUR', 'EUR', 'GBP', 'PAXG', 'WBTC', 'USD1', 'USDE', 'SUSD', 'FRAX', 'LUSD', 'GUSD', 'FUSD', 'ZAMA', 'ZEC', 'TROY', 'PUMP', 'ASTER'];
                const relevant = res.data.filter(p => {
                    if (!p.symbol.endsWith('USDT')) return false;
                    if (!/^[A-Z0-9]+$/.test(p.symbol)) return false;
                    if (BLACKLIST.some(blocked => p.symbol.includes(blocked))) return false;
                    return parseFloat(p.quoteVolume) > 5000000;
                });
                relevant.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
                const finalPairs = relevant.slice(0, 12).map(p => p.symbol);

                try {
                    await redis.set('sentinel_active_pairs', JSON.stringify(finalPairs));
                } catch (redisErr) { console.warn('⚠️ Failed to save top pairs to Redis:', redisErr.message); }

                return finalPairs;
            }
        } catch (e) {
            console.warn(`⚠️ Dynamic Pairs [${src.label}] Fail: ${e.message}`);
        }
    }
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'BNBUSDT', 'AVAXUSDT', 'LINKUSDT'];
}

async function fetchGlobalPrice(symbol, cache = null) {
    if (cache && cache[symbol]) return { ...cache[symbol], source: 'WS_CACHE' };
    const sources = [
        { url: `https://api-gcp.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`, label: 'REST_EU_GCP' },
        { url: `https://api1.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`, label: 'REST_EU_ALT' },
        { url: `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`, label: 'REST_GLOBAL' }
    ];
    for (const src of sources) {
        try {
            const res = await axios.get(src.url, { timeout: 3000 });
            lastWorkingSource = src.label.includes('US') ? 'USA' : 'EU';
            return { price: parseFloat(res.data.bidPrice), bid: parseFloat(res.data.bidPrice), ask: parseFloat(res.data.askPrice), source: src.label };
        } catch (e) { continue; }
    }
    return null;
}

async function fetchGlobalKlines(symbol, interval, limit = 250) {
    const sources = [
        { url: `https://api-gcp.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, label: 'EU_GCP' },
        { url: `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, label: 'GLOBAL' }
    ];
    for (const src of sources) {
        try {
            const res = await axios.get(src.url, { timeout: 5000 });
            if (res.data && Array.isArray(res.data)) { lastWorkingSource = src.label; return res.data; }
        } catch (e) { if (!e.response || e.response.status !== 403) break; }
    }
    return null;
}

// --- ⚡ CORE ENGINE ---
async function processMode(mode, marketPairs, marketCache, marketRegime, manualOpportunities = null) {
    const suffix = mode === 'LIVE' ? '_real' : '_sim';
    const configKey = mode === 'LIVE' ? 'sentinel_wallet_config_real' : 'sentinel_wallet_config_sim';
    const activeKey = `sentinel_active_trades${suffix}`;
    const historyKey = `sentinel_win_history${suffix}`;

    // 1. READ INITIAL STATE (Snapshot)
    const [activeTradesStr, winHistoryStr, walletConfigStr, globalLockdown] = await redis.mget([activeKey, historyKey, configKey, 'sentinel_lockdown']);

    if (globalLockdown === 'true') {
        // console.log(`[${mode}] ⛔ GLOBAL LOCKDOWN ACTIVE. SKIPPING CYCLE.`);
        // return { activeAccount: 0, active: [], history: [] };
        // FIXED: We do NOT return early. We continue to monitor active trades.
    }

    let activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
    let winHistory = winHistoryStr ? JSON.parse(winHistoryStr) : [];
    let wallet = walletConfigStr ? JSON.parse(walletConfigStr) : {
        initialBalance: 1000,
        currentBalance: 1000,
        riskPercentage: 10,
        maxTrades: 3,
        strategy: 'HYBRID_BLITZ'
    };

    // SYNC BALANCE LIVE
    if (mode === 'LIVE') {
        try {
            const usdt = await binanceClient.getAccountBalance('USDT');
            if (usdt && !usdt.error) {
                wallet.currentBalance = usdt.total;
                await redis.set(configKey, JSON.stringify(wallet));
            }
        } catch (e) { }
    }

    // --- SNAPSHOT ID LIST for Race Condition Logic ---
    const snapshotIds = activeTrades.map(t => t.id);

    // 2. MONITOR ACTIVE TRADES (Parallel Price Checks - No Lock)
    const monitorPromises = activeTrades.map(async (trade) => {
        try {
            const symbol = trade.symbol;

            // Auto Clean Invalid
            if (!/^[A-Z0-9]+$/.test(symbol) || symbol.includes('ZAMA')) return { status: 'CLOSED', win: { ...trade, pnl: 0, profitUsd: 0, strategy: 'PURGE' }, id: trade.id };

            const marketData = await fetchGlobalPrice(symbol, marketCache);
            if (!marketData || !marketData.price) return { status: 'KEEP', trade };

            const currentPrice = marketData.price;
            const currentBid = marketData.bid;
            const currentAsk = marketData.ask;
            let pnl = trade.type === 'SHORT' ? ((trade.entryPrice - currentAsk) / trade.entryPrice) * 100 : ((currentBid - trade.entryPrice) / trade.entryPrice) * 100;

            // TRAILING STOP LOGIC (Memory only first)
            let updatedTrade = { ...trade };
            let isExit = false;

            if (pnl >= 0.7) {
                const trailMargin = 0.002;
                let newTrailingSL = 0;
                let trailingTriggered = false;

                if (trade.type === 'SHORT') {
                    newTrailingSL = currentPrice * (1 + trailMargin);
                    if (!trade.stopLoss || newTrailingSL < trade.stopLoss) {
                        updatedTrade.stopLoss = newTrailingSL;
                        trailingTriggered = true;
                    }
                } else {
                    newTrailingSL = currentPrice * (1 - trailMargin);
                    if (!trade.stopLoss || newTrailingSL > trade.stopLoss) {
                        updatedTrade.stopLoss = newTrailingSL;
                        trailingTriggered = true;
                    }
                }

                if (trailingTriggered || trade.isTrailing) {
                    updatedTrade.isTrailing = true;
                    if (trailingTriggered) console.log(`[${mode}] ⛓️ TRAILING STOP: ${symbol} @ +${pnl.toFixed(2)}%`);
                }
            }

            // CHECK EXIT CONDITIONS
            const hasSpecificSL = updatedTrade.stopLoss !== null && updatedTrade.stopLoss !== undefined;
            const effectiveTP = wallet.takeProfit || 1.5;
            let tradeTP = effectiveTP;
            if (trade.takeProfit) {
                tradeTP = Math.abs(trade.type === 'SHORT' ? ((trade.entryPrice - trade.takeProfit) / trade.entryPrice) * 100 : ((trade.takeProfit - trade.entryPrice) / trade.entryPrice) * 100);
            }

            if (hasSpecificSL) {
                if (trade.type === 'LONG' && currentPrice <= updatedTrade.stopLoss) isExit = true;
                else if (trade.type === 'SHORT' && currentPrice >= updatedTrade.stopLoss) isExit = true;
            }
            if (pnl >= tradeTP) isExit = true;

            if (isExit) {
                const qty = trade.quantity || (trade.investedAmount / trade.entryPrice);
                console.log(`[${mode}] 📉 CLOSING POSITION: ${symbol} ...`);

                let netProfit = 0, finalPnl = 0, executionPrice = currentPrice;
                try {
                    const order = await binanceClient.executeOrder(symbol, 'SELL', qty, currentPrice, 'MARKET', mode === 'LIVE');
                    const received = parseFloat(order.cummulativeQuoteQty);
                    const fee = received * 0.001;
                    netProfit = received - trade.investedAmount - (trade.entryFee || 0) - fee;
                    finalPnl = (netProfit / trade.investedAmount) * 100;
                    executionPrice = received / parseFloat(order.executedQty) || currentPrice;
                } catch (err) {
                    if (err.message && (err.message.includes('-2010') || err.message.includes('insufficient'))) {
                        netProfit = 0; finalPnl = 0; // Force Close
                    } else { throw err; }
                }

                if (mode === 'SIMULATION') {
                    // Correct Simulation Math
                    const simQty = trade.quantity || (trade.investedAmount / trade.entryPrice);
                    const entryFee = trade.investedAmount * 0.001;
                    const exitFee = (currentPrice * simQty) * 0.001;
                    const totalFee = entryFee + exitFee;

                    let grossProfit = 0;
                    if (trade.type === 'SHORT') {
                        grossProfit = (trade.entryPrice - currentPrice) * simQty;
                    } else {
                        grossProfit = (currentPrice - trade.entryPrice) * simQty;
                    }

                    netProfit = grossProfit - totalFee;
                    finalPnl = (netProfit / trade.investedAmount) * 100;
                    executionPrice = currentPrice;

                    wallet.currentBalance += (trade.investedAmount + netProfit);
                }

                const win = {
                    ...trade,
                    pnl: finalPnl || 0,
                    profitUsd: netProfit || 0,
                    timestamp: new Date().toISOString(),
                    entryTimestamp: trade.timestamp,
                    exitPrice: executionPrice
                };
                const emoji = netProfit >= 0 ? '🟢' : '🔴';
                await sendRawTelegram(`🚨 **[${mode}] AUTO CLOSE: ${symbol}**\n${emoji} ROI: ${finalPnl.toFixed(2)}%\n💰 $${netProfit.toFixed(2)}`);

                return { status: 'CLOSED', win, id: trade.id };
            }

            return { status: 'KEEP', trade: updatedTrade };
        } catch (e) {
            console.error(`Status Monitor Error ${trade.symbol}`, e.message);
            return { status: 'KEEP', trade }; // Keep on error
        }
    });

    const monitorResults = await Promise.all(monitorPromises);

    // 3. SCAN NEW (Parallel - No Lock)
    let newScanTrades = [];

    // 🔥 LOCKDOWN CHECK: Only block NEW trades
    const isLockdown = globalLockdown === 'true';
    if (isLockdown) {
        console.log(`[${mode}] ⛔ LOCKDOWN: Monitoring Active Trades Only. No new entries.`);
    }

    if (wallet.isBotActive && !isLockdown) {
        const currentlyActive = monitorResults.filter(r => r.status === 'KEEP').length;
        if (currentlyActive < (wallet.maxTrades || 3)) {
            const currentPairs = await getDynamicTopPairs();
            const occupied = activeTrades.map(t => t.symbol);

            // COOLDOWN LOGIC (15 Minutes for all) ❄️
            const COOLDOWN_MS = 15 * 60 * 1000;
            const now = Date.now();

            const recentCloses = winHistory
                .filter(w => (now - new Date(w.timestamp).getTime()) < COOLDOWN_MS)
                .map(w => w.symbol);

            const excludedSymbols = [...new Set(recentCloses)];

            if (excludedSymbols.length > 0) {
                console.log(`❄️ EXCLUSION ACTIVE: ${excludedSymbols.join(', ')}`);
            }

            const candidates = currentPairs.filter(s => !occupied.includes(s) && !excludedSymbols.includes(s));

            // LOG: Show what we are scanning
            if (candidates.length > 0) {
                console.log(`📡 [${mode}] SCANNING ${candidates.length} COINS: ${candidates.join(', ')}`);
            } else {
                console.log(`💤 [${mode}] NO CANDIDATES TO SCAN (All occupied or blacklisted)`);
            }

            for (const symbol of candidates) {
                if (newScanTrades.length + currentlyActive >= (wallet.maxTrades || 3)) break;
                // Quick Check
                try {
                    const candles = await fetchGlobalKlines(symbol, '5m', 60);
                    if (candles) {
                        const analysisRes = analysis.analyzeBlitz(null, candles);
                        if (analysisRes.prediction?.signal.includes('BUY') && analysisRes.prediction.intensity > 30) {
                            const pd = await fetchGlobalPrice(symbol);
                            if (pd) {
                                const risk = wallet.riskPercentage || 10;
                                const invest = wallet.currentBalance * (risk / 100);
                                let qty = invest / pd.price;
                                let realInvest = invest;

                                // 🧬 HYBRID FILTER CHECK
                                // If config says "useHybrid" (default true for safety now), check odds
                                const strategyConfig = wallet.strategyConfig?.HYBRID_BLITZ || {};
                                const useHybrid = strategyConfig.useHybrid !== false; // Default ON
                                const minOdds = parseFloat(strategyConfig.minOdds || 67); // Default 67%

                                const odds = parseFloat(analysisRes.indicators.hybrid?.odds || 50);

                                if (useHybrid && odds < minOdds) {
                                    console.log(`[${mode}] 🧬 HYBRID PROTECT: Skipping ${symbol} (Odds: ${odds}% < ${minOdds}%)`);
                                    continue; // SKIP THIS TRADE
                                }

                                if (mode === 'LIVE') {
                                    const order = await binanceClient.executeOrder(symbol, 'BUY', invest, pd.price, 'MARKET', true);
                                    qty = parseFloat(order.executedQty);
                                    realInvest = parseFloat(order.cummulativeQuoteQty);
                                } else {
                                    wallet.currentBalance -= invest;
                                }

                                newScanTrades.push({
                                    id: uuidv4(),
                                    symbol,
                                    entryPrice: realInvest / qty,
                                    investedAmount: realInvest,
                                    quantity: qty,
                                    type: 'LONG',
                                    timestamp: new Date().toISOString(),
                                    strategy: 'BLITZ',
                                    mode: mode,
                                    isManual: false,
                                    stopLoss: analysisRes.obZone?.sl || null,
                                    takeProfit: analysisRes.obZone?.tp || null
                                });
                                console.log(`🚀 [${mode}] AUTO-ENTRY: ${symbol}`);
                                await sendRawTelegram(`🤖 **[${mode}] AUTO ENTRY**\n🚀 ${symbol}`);
                            }
                        }
                    }
                } catch (e) { }
            }
        }
    }

    // 4. ATOMIC SAVE (LOCK)
    try {
        await runWithLock(`trades_${mode}`, async () => {
            // A. RE-READ STATE
            const [finalFreshTradesStr, finalFreshHistStr] = await redis.mget([activeKey, historyKey]);
            const dbTrades = finalFreshTradesStr ? JSON.parse(finalFreshTradesStr) : [];
            let dbHistory = finalFreshHistStr ? JSON.parse(finalFreshHistStr) : [];

            // B. MERGE
            const nextActiveList = [];

            // Loop through what the DB currently has
            for (const dbTrade of dbTrades) {
                // Was this trade Monitored in this cycle?
                const res = monitorResults.find(r => r.id === dbTrade.id);

                if (res) {
                    // Yes, we tracked it.
                    if (res.status === 'CLOSED') {
                        // We decided to close it. Add to history.
                        dbHistory.unshift(res.win);

                        // 💀 PAIN MEMORY REMOVED: Just standard logging
                        if (res.win.profitUsd < 0) {
                            console.log(`📉 LOSS DETECTED on ${dbTrade.symbol}. No Blacklist (Standard Cooldown only).`);
                        }
                        // Do NOT add to nextActiveList
                    } else {
                        // We decided to keep it.
                        // Update it with new calculated props (SL change)
                        // But preserve any props changed in DB (unlikely if locked, but safety)
                        nextActiveList.push({ ...dbTrade, ...res.trade });
                    }
                } else {
                    // No, this trade wasn't in our snapshot.
                    // It must have been added Manually WHILE we were checking prices.
                    // KEEP IT SAFE.
                    nextActiveList.push(dbTrade);
                }
            }

            // Add New Scan Trades
            if (newScanTrades.length > 0) {
                nextActiveList.push(...newScanTrades);
            }

            // Cap History
            if (dbHistory.length > 50) dbHistory = dbHistory.slice(0, 50);

            // C. WRITE
            await redis.set(activeKey, JSON.stringify(nextActiveList));
            await redis.set(historyKey, JSON.stringify(dbHistory));
            await redis.set(configKey, JSON.stringify(wallet));

            console.log(`✅ [${mode}] Cycle Complete. Active: ${nextActiveList.length}`);
            activeTrades = nextActiveList; // for display return
        }, 10000);

    } catch (lockError) {
        console.error(`❌ LOCK FAILED [${mode}]:`, lockError.message);
    }

    return { activeAccount: activeTrades.length, active: activeTrades, history: winHistory };
}

export default async function handler(req, res) {
    // 🛡️ SECURITY LOCKDOWN (CRON_SECRET)
    // CRITICAL: We also check if CRON_SECRET is set in ENV. If not, we BLOCK EVERYTHING to prevent "undefined === undefined" bypass.
    if (!process.env.CRON_SECRET || req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
        console.warn(`⛔ UNAUTHORIZED ACCESS ATTEMPT to check-prices from ${req.headers['x-forwarded-for'] || 'unknown'}`);
        return res.status(401).json({ error: '⛔ UNAUTHORIZED: Access Denied. Security Handshake Failed.' });
    }

    console.log('🚀 [DUAL ENGINE] check-prices START');
    try {
        const marketCache = {};
        const marketPairs = await getDynamicTopPairs();

        const tasks = [];
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
