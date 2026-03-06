
import axios from 'axios';
import redis from './utils/redisClient.js';
import binanceClient from './utils/binance-client.js';
import { runWithLock } from './utils/locker.js';

// --- IMPORT CORE MODULES ---
import { monitorActiveTrades } from './core/trade-monitor.js';
import { scanMarketOpportunities } from './core/market-scanner.js';
import { checkBTCGuardStatus } from '../lib/core/btc-guard.js';
import marketWorker from './stream/market-worker.js';

// --- Shared Helper (With 15-Min Cache) ---
let lastTopPairs = [];
let lastPairSync = 0;
let lastBalanceSync = 0; // New: Global tracker for balance sync rate limit safety

async function getDynamicTopPairs() {
    const now = Date.now();
    // Only refresh top pairs list every 15 minutes (900000ms)
    if (lastTopPairs.length > 0 && (now - lastPairSync) < 900000) {
        return lastTopPairs;
    }

    const sources = [
        { url: 'https://api.binance.com/api/v3/ticker/24hr', label: 'EU' }
    ];
    for (const src of sources) {
        try {
            const res = await axios.get(src.url, { timeout: 5000 });
            if (res.data && Array.isArray(res.data)) {
                // BLACKLIST: TOKENS QUE NO QUEREMOS OPERAR (ESTABLES O NO DESEADOS)
                const BLACKLIST = ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'AEUR', 'EUR', 'GBP', 'PAXG', 'WBTC', 'USD1', 'USDE', 'SUSD', 'FRAX', 'LUSD', 'GUSD', 'FUSD', 'ZAMA', 'ZEC', 'TROY', 'PUMP', 'ASTER', 'PEPE', 'NEAR', 'U'];
                const relevant = res.data.filter(p => {
                    if (!p.symbol.endsWith('USDT')) return false;
                    if (!/^[A-Z0-9]+$/.test(p.symbol)) return false;
                    
                    // Extraemos el activo base (ej: BTC de BTCUSDT)
                    const baseAsset = p.symbol.replace('USDT', '');
                    if (BLACKLIST.includes(baseAsset)) return false;
                    
                    return parseFloat(p.quoteVolume) > 5000000;
                });
                relevant.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
                const finalPairs = relevant.slice(0, 12).map(p => p.symbol);

                lastTopPairs = finalPairs;
                lastPairSync = now;

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
            return { price: parseFloat(res.data.bidPrice), bid: parseFloat(res.data.bidPrice), ask: parseFloat(res.data.askPrice), source: src.label };
        } catch (e) { continue; }
    }
    return null;
}

// --- ⚡ CORE ORCHESTRATOR ---
async function processMode(mode, marketPairs, marketCache) {
    const suffix = mode === 'LIVE' ? '_real' : '_sim';
    const configKey = mode === 'LIVE' ? 'sentinel_wallet_config_real' : 'sentinel_wallet_config_sim';
    const activeKey = `sentinel_active_trades${suffix}`;
    const historyKey = `sentinel_win_history${suffix}`;

    // 1. READ INITIAL STATE (Snapshot)
    const [activeTradesStr, winHistoryStr, walletConfigStr, globalLockdown] = await redis.mget([activeKey, historyKey, configKey, 'sentinel_lockdown']);

    let activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];
    let winHistory = winHistoryStr ? JSON.parse(winHistoryStr) : [];
    let wallet = walletConfigStr ? JSON.parse(walletConfigStr) : {
        currentBalance: 1000,
        riskPercentage: 10,
        maxTrades: 3,
        strategy: 'HYBRID_VORTEX'
    };

    // SYNC BALANCE LIVE (Slowed down to 60s for Rate Limit Safety)
    const now = Date.now();
    if (mode === 'LIVE' && (now - lastBalanceSync) > 60000) {
        try {
            const usdt = await binanceClient.getAccountBalance('USDT');
            if (usdt && !usdt.error) {
                // USAR 'available' en lugar de 'total' para evitar intentar usar fondos bloqueados
                wallet.currentBalance = usdt.available; 
                await redis.set(configKey, JSON.stringify(wallet));
                lastBalanceSync = now;
                console.log(`⚖️ [LIVE] Usable Balance Synced: $${wallet.currentBalance}`);
            }
        } catch (e) { }
    }

    // --- STEP 0: PRE-FETCH PRICES FOR ACTIVE TRADES ---
    // Ensure the Monitor has data to work with
    if (activeTrades.length > 0) {
        const pricePromises = activeTrades.map(t => fetchGlobalPrice(t.symbol));
        const prices = await Promise.all(pricePromises);
        prices.forEach((p, index) => {
            if (p) marketCache[activeTrades[index].symbol] = p;
        });
    }

    // --- STEP 1: MONITOR ACTIVE TRADES (The Bodyguard) ---
    // (Always runs, extremely fast, no external scanning)
    const monitorResult = await monitorActiveTrades(activeTrades, marketCache, mode, wallet);

    // Check if we need to purge invalid trades or simply update statuses
    const updatedActiveTrades = monitorResult.active;
    const closedTrades = monitorResult.history; // New closures from this cycle

    // --- STEP 2: SCAN NEW OPPORTUNITIES (The Explorer) ---
    let newScanTrades = [];

    // 🛡️ BTC GUARD CHECK
    const useBtcGuard = wallet.strategyConfig?.HYBRID_VORTEX?.useBtcGuard === true;
    let btcVeto = false;

    if (useBtcGuard) {
        try {
            const guard = await checkBTCGuardStatus();
            const btcChange = guard.btcChange;

            // Save to Redis for UI
            await redis.set('sentinel_btc_change', btcChange.toFixed(2));

            // CRASH CRITERIA: -1.5% drop (From lib/core/btc-guard)
            if (guard.status === 'DANGER') {
                btcVeto = true;
                console.log(`🛡️ [BTC GUARD] ⛔ VETO ACTIVE: Bitcoin is erratic (${btcChange.toFixed(2)}%). Pausing entries.`);
            }
        } catch (err) {
            console.warn(`🛡️ [BTC GUARD] ⚠️ Failed to check BTC health: ${err.message}. Proceeding with caution.`);
        }
    } else {
        // Clear value if guard is off (optional, but keeps UI clean)
        await redis.del('sentinel_btc_change');
    }

    // Lockdown Check (Global Emergency)
    const isLockdown = globalLockdown === 'true';

    if (isLockdown) {
        console.log(`[${mode}] ⛔ NO ENTRIES: Emergency Lockdown Active`);
    } else if (wallet.isBotActive) {
        const slotsAvailable = (wallet.maxTrades || 3) - updatedActiveTrades.length;

        if (slotsAvailable > 0) {
            // Filter Candidates (Not occupied, not in cooldown)
            const occupied = activeTrades.map(t => t.symbol);

            const COOLDOWN_MS = 15 * 60 * 1000;
            const now = Date.now();
            const recentCloses = winHistory
                .filter(w => (now - new Date(w.timestamp).getTime()) < COOLDOWN_MS)
                .map(w => w.symbol);

            closedTrades.forEach(c => recentCloses.push(c.symbol));
            const excludedSymbols = [...new Set(recentCloses)];

            const candidates = marketPairs.filter(s => !occupied.includes(s) && !excludedSymbols.includes(s));

            if (candidates.length > 0) {
                // 🔥 CALL THE SCANNER: We pass btcVeto so it can filter Vortex but let UNIXA pass
                newScanTrades = await scanMarketOpportunities(candidates, mode, wallet, marketCache, updatedActiveTrades.length, btcVeto);
            } else {
                // Keep logs quiet if no candidates
            }
        }
    }

    // --- STEP 3: ATOMIC SAVE (The Vault) ---
    try {
        await runWithLock(`trades_${mode}`, async () => {
            // A. RE-READ STATE (To avoid race conditions with Manual Trades)
            const [finalFreshTradesStr, finalFreshHistStr] = await redis.mget([activeKey, historyKey]);
            const dbTrades = finalFreshTradesStr ? JSON.parse(finalFreshTradesStr) : [];
            let dbHistory = finalFreshHistStr ? JSON.parse(finalFreshHistStr) : [];

            // B. MERGE LOGIC
            const nextActiveList = [];

            // 1. Process Surviving Trades
            for (const dbTrade of dbTrades) {
                // Find corresponding update from Monitor
                const updated = updatedActiveTrades.find(u => u.id === dbTrade.id);
                if (updated) {
                    // It survived the monitor. Keep it (with updated SL/TP if modified).
                    nextActiveList.push(updated);
                } else {
                    // It was NOT in our 'updatedActiveTrades' list?
                    // It implies either:
                    // a) It was CLOSED by monitor (so it's in closedTrades list conceptually)
                    // b) It was just added MANUALLY while we were processing? (Race condition)

                    // Check if it was explicitly closed in this cycle
                    const wasClosedHere = closedTrades.find(c => c.id === dbTrade.id);
                    if (!wasClosedHere) {
                        // It wasn't closed by us. It must be a new manual trade added mid-cycle. Keep it.
                        nextActiveList.push(dbTrade);
                    }
                }
            }

            // 2. Add New Auto-Entries
            if (newScanTrades && newScanTrades.length > 0) {
                nextActiveList.push(...newScanTrades);
                // Deduct Balance for SIM
                if (mode === 'SIMULATION') {
                    newScanTrades.forEach(t => {
                        // Aplicamos un factor de seguridad del 99.7% para evitar errores de insuficiencia por cambios de precio decimales
                        const safetyFactor = 0.997;
                        wallet.currentBalance -= (t.investedAmount * safetyFactor);
                    });
                }
            }

            // 3. Add New Closures to History
            if (closedTrades.length > 0) {
                dbHistory.unshift(...closedTrades);
                // Credit Balance for SIM
                if (mode === 'SIMULATION') {
                    closedTrades.forEach(t => {
                        wallet.currentBalance += (t.investedAmount + t.profitUsd);
                    });
                }
            }

            // Cap History
            if (dbHistory.length > 50) dbHistory = dbHistory.slice(0, 50);

            // C. WRITE
            await redis.set(activeKey, JSON.stringify(nextActiveList));
            await redis.set(historyKey, JSON.stringify(dbHistory));
            await redis.set(configKey, JSON.stringify(wallet));

            const strategyConfig = wallet.strategyConfig?.HYBRID_VORTEX || {};
            const enabledStrats = [];
            if (strategyConfig.useVortex !== false) enabledStrats.push('VTX');
            if (strategyConfig.useHybrid !== false) enabledStrats.push('HYB');
            if (strategyConfig.useUnixa === true) enabledStrats.push('UNX');

            console.log(`✅ [${mode}] Cycle Complete | Active: ${nextActiveList.length} | Strats: ${enabledStrats.join('+')}`);
            activeTrades = nextActiveList; // For return display
            winHistory = dbHistory;

        }, 10000); // 10s Lock

    } catch (lockError) {
        console.error(`❌ LOCK FAILED [${mode}]:`, lockError.message);
    }

    return { activeAccount: activeTrades.length, active: activeTrades, history: winHistory };
}

export default async function handler(req, res) {
    if (!process.env.CRON_SECRET || req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
        return res.status(401).json({ error: '⛔ UNAUTHORIZED' });
    }

    console.log('🚀 [DUAL ENGINE] check-prices START');
    try {
        // Phase 1: High-Speed Cache Sync (Use WebSocket data for monitoring)
        const marketCache = marketWorker.getAllMarketData() || {};

        // Populate cache slightly for efficiency (Top pairs prices)
        const marketPairs = await getDynamicTopPairs();
        // We could pre-fetch prices here, but market-scanner does its own checks for now.
        // Let's at least get checking prices for active management in Monitor.
        // For simple Orchestration, we let modules fetch what they need or pass a basic cache.
        // To keep it simple in Refactor Phase 1, we pass empty cache and let Monitor fetch if needed 
        // (Monitor code I wrote handles missing cache by skipping or blindly keeping, 
        // BUT wait, Monitor needs prices. I should pre-fetch prices for ACTIVE trades at least.)

        // ⚠️ SEQUENTIAL (not parallel) to avoid race conditions reading stale Redis state
        await processMode('SIMULATION', marketPairs, marketCache);
        if (process.env.BINANCE_API_KEY) {
            await processMode('LIVE', marketPairs, marketCache);
        }
        res.status(200).json({ status: 'OK' });
    } catch (error) {
        console.error('❌ CRITICAL ERROR:', error.message);
        res.status(500).json({ error: error.message });
    }
}
