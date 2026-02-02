import axios from 'axios';
import { RSI, EMA, BollingerBands } from 'technicalindicators';
import * as analysis from '../src/utils/analysis.js';
import redis from '../src/utils/redisClient.js';
import binanceClient from './utils/binance-client.js';
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
    const sources = [
        { url: `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`, label: 'REST_EU' },
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
        { url: `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, label: 'EU' },
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
    const suffix = mode === 'LIVE' ? '_real' : '_sim';
    const configKey = mode === 'LIVE' ? 'sentinel_wallet_config_real' : 'sentinel_wallet_config_sim';
    const activeKey = `sentinel_active_trades${suffix}`;
    const historyKey = `sentinel_win_history${suffix}`;
    const sniperKey = `sentinel_sniper_trades${suffix}`;

    const activeTradesStr = await redis.get(activeKey);
    const winHistoryStr = await redis.get(historyKey);
    const walletConfigStr = await redis.get(configKey);
    const sniperTradesStr = await redis.get(sniperKey);

    let activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
    let sniperTrades = sniperTradesStr ? JSON.parse(sniperTradesStr) : [];
    let winHistory = winHistoryStr ? JSON.parse(winHistoryStr) : [];
    let wallet = walletConfigStr ? JSON.parse(walletConfigStr) : {
        initialBalance: 1000, currentBalance: 1000, riskPercentage: 10, allocatedCapital: 500,
        tradingMode: mode, isBotActive: true, maxTrades: 3, dailyLossLimit: 50, cooldownMinutes: 30,
        strategyConfig: { SNIPER: { active: true }, HYBRID_SWING: { active: true }, HYBRID_BLITZ: { active: false } }
    };

    if (!wallet.strategyConfig) {
        wallet.strategyConfig = { SNIPER: { active: true }, HYBRID_SWING: { active: true }, HYBRID_BLITZ: { active: false } };
    }

    console.log(`[${mode}] 💼 Config: ${Object.keys(wallet.strategyConfig || {}).filter(k => wallet.strategyConfig[k].active).join(', ')} | Active: ${activeTrades.length}`);

    // Guards
    if (activeTrades.length >= (wallet.maxTrades || 3)) {
        console.log(`[${mode}] 🛡️ Max trades reached (${activeTrades.length}).`);
        return { mode, activeCount: activeTrades.length, alerts: [] };
    }

    const today = new Date().toISOString().split('T')[0];
    const dailyLossAmount = winHistory.filter(t => t.timestamp && t.timestamp.startsWith(today) && t.pnlAmount < 0).reduce((sum, t) => sum + Math.abs(t.pnlAmount), 0);
    if (dailyLossAmount >= (wallet.dailyLossLimit || 50)) {
        console.log(`[${mode}] 🛡️ Daily loss limit reached.`);
        return { mode, activeCount: activeTrades.length, alerts: [] };
    }

    const alertsSent = [];
    const STRATEGY_PRIORITY = ['SNIPER', 'HYBRID_SWING', 'HYBRID_BLITZ'];
    const activeStrategies = STRATEGY_PRIORITY.filter(s => wallet.strategyConfig?.[s]?.active);

    if (activeStrategies.length === 0) {
        console.log(`[${mode}] ⏹️ All strategies paused.`);
        return { mode, activeCount: activeTrades.length, alerts: [] };
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
                alertsSent.push(`${opp.symbol} (${opp.type})`);
            }
        }
    }

    // --- Monitor & Scan Loop ---
    const activeSymbols = activeTrades.map(t => t.symbol);
    const uniquePairs = Array.from(new Set([...marketPairs, ...activeSymbols]));

    for (const symbol of uniquePairs) {
        try {
            const marketData = await fetchGlobalPrice(symbol, marketCache);
            if (!marketData || !marketData.price) continue;

            const currentPrice = marketData.price;
            const currentBid = marketData.bid;
            const currentAsk = marketData.ask;

            // 1. MONITOR EXITS
            const tradeIndex = newActiveTrades.findIndex(t => t.symbol === symbol);
            if (tradeIndex !== -1) {
                const trade = newActiveTrades[tradeIndex];
                let exitPrice = trade.type === 'SHORT' ? currentAsk : currentBid;
                let pnl = trade.type === 'SHORT' ? ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100 : ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;

                const tradeStrat = trade.strategy || 'SWING';
                let target = (tradeStrat === 'SCALP') ? 0.8 : (tradeStrat === 'TRIPLE' ? 3.0 : (wallet.takeProfit || 1.25));
                const adaptiveTarget = target + (marketRegime.regime === 'TRENDING' ? 0.5 : 0.2);

                let isExit = (pnl >= adaptiveTarget);
                if (wallet.useStopLoss && pnl <= -(wallet.stopLoss || 3.0)) isExit = true;

                if (isExit) {
                    const qty = trade.quantity || (trade.investedAmount / trade.entryPrice);
                    try {
                        const order = await binanceClient.executeOrder(symbol, 'SELL', qty, currentPrice, 'MARKET', mode === 'LIVE');
                        const received = parseFloat(order.cummulativeQuoteQty);
                        const fee = received * 0.001;
                        const netProfit = received - trade.investedAmount - (trade.entryFee || 0) - fee;
                        const finalPnl = (netProfit / trade.investedAmount) * 100;

                        if (mode === 'SIMULATION') wallet.currentBalance += (received - fee);

                        newWins.push({ symbol, pnl: finalPnl, profitUsd: netProfit, timestamp: new Date().toISOString(), strategy: tradeStrat, mode: mode });
                        newActiveTrades.splice(tradeIndex, 1);
                        await sendRawTelegram(`🏆 **[${mode}] WIN: ${symbol}**\n📈 ROI: +${finalPnl.toFixed(2)}%\n💰 Profit: $${netProfit.toFixed(2)}`);
                    } catch (e) {
                        console.error(`[${mode}] SELL FAILED: ${symbol}`, e.message);
                    }
                }
            }

            // 2. SCAN ENTRIES (If slot available)
            if (newActiveTrades.length < (wallet.maxTrades || 3) && tradeIndex === -1) {
                const klines = await fetchGlobalKlines(symbol, '4h', 50); // Default SWING timeframe
                if (!klines) continue;
                const rsi = RSI.calculate({ values: klines.map(c => parseFloat(c[4])), period: 14 }).slice(-1)[0] || 50;

                // Extremely simple RSI Entry for this demo/re-engineering
                if (rsi < 30) {
                    const capital = mode === 'LIVE' ? (wallet.allocatedCapital || 500) : wallet.currentBalance;
                    const invested = capital * ((wallet.riskPercentage || 10) / 100);
                    if (invested >= 6) {
                        try {
                            const order = await binanceClient.executeOrder(symbol, 'BUY', invested, currentPrice, 'MARKET', mode === 'LIVE');
                            const spent = parseFloat(order.cummulativeQuoteQty);
                            const fillPrice = spent / parseFloat(order.executedQty);
                            const fee = spent * 0.001;
                            if (mode === 'SIMULATION') wallet.currentBalance -= (spent + fee);

                            newActiveTrades.push({
                                id: uuidv4(), symbol, entryPrice: fillPrice, type: 'LONG', timestamp: new Date().toISOString(),
                                investedAmount: spent, quantity: parseFloat(order.executedQty), entryFee: fee, strategy: 'RSI_AUTO', mode: mode
                            });
                            await sendRawTelegram(`🔵 **[${mode}] AUTO ENTRY**\n💎 ${symbol}\n💰 RSI: ${rsi.toFixed(1)}\n💵 Price: $${fillPrice.toFixed(4)}`);
                        } catch (e) { console.error(`[${mode}] BUY FAILED: ${symbol}`, e.message); }
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
    return { mode, activeCount: newActiveTrades.length, alerts: alertsSent };
}

export default async function handler(req, res) {
    console.log('🚀 [DUAL ENGINE] check-prices START');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const PORT = process.env.PORT || 8080;
        let marketCache = {};
        try { const cacheRes = await axios.get(`http://127.0.0.1:${PORT}/api/market-cache`, { timeout: 1000 }); marketCache = cacheRes.data; } catch (e) { }

        const marketPairs = await getDynamicTopPairs();

        const btcKlines = await fetchGlobalKlines('BTCUSDT', '1h', 50);
        let marketRegime = { regime: 'RANGING', label: 'LATERAL ⚖️' };
        if (btcKlines) marketRegime = analysis.detectRegime(btcKlines.map(c => ({ close: parseFloat(c[4]) })));

        // --- DUAL EXECUTION ---
        const activeModeUI = await redis.get('sentinel_active_mode') || 'SIMULATION';
        const manualOpps = req.method === 'POST' ? req.body?.opportunities : null;

        // Run both in parallel
        const [simResult, liveResult] = await Promise.all([
            processMode('SIMULATION', marketPairs, marketCache, marketRegime, activeModeUI === 'SIMULATION' ? manualOpps : null),
            processMode('LIVE', marketPairs, marketCache, marketRegime, activeModeUI === 'LIVE' ? manualOpps : null)
        ]);

        console.log(`✅ DUAL ENGINE COMPLETE | SIM: ${simResult.activeCount} | LIVE: ${liveResult.activeCount}`);

        // Return current UI mode results to frontend
        const uiResult = activeModeUI === 'LIVE' ? liveResult : simResult;
        res.status(200).json({ status: 'DUAL_ENGINE_SYNCED', mode: activeModeUI, activeCount: uiResult.activeCount, newAlerts: uiResult.alerts });

    } catch (error) {
        console.error('❌ DUAL ENGINE CRITICAL:', error.message);
        res.status(500).json({ error: error.message });
    }
}
