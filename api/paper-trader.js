
import { analyzeCoin } from './prediction-router.js';

// SIMULATION STATE
let portfolio = {
    balance: 1000,
    positions: [],
    history: []
};

// CONFIGURABLE SETTINGS
let config = {
    tp: 1.035, // 3.5%
    sl: 0.98,  // 2.0%
    tradeSize: 100 // Fixed USD Amount
};

export function updateConfig(newSettings) {
    if (newSettings.balance) portfolio.balance = parseFloat(newSettings.balance);
    if (newSettings.tradeSize) config.tradeSize = parseFloat(newSettings.tradeSize);
    if (newSettings.tp) config.tp = 1 + (parseFloat(newSettings.tp) / 100);
    if (newSettings.sl) config.sl = 1 - (parseFloat(newSettings.sl) / 100);

    console.log("⚙️ CONFIG UPDATED:", config);
    return { ...portfolio, config };
}

export function getConfig() {
    return {
        balance: portfolio.balance,
        tradeSize: config.tradeSize,
        tp: ((config.tp - 1) * 100).toFixed(1),
        sl: ((1 - config.sl) * 100).toFixed(1)
    };
}

const COINS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'
];

export async function tick() {
    console.log("🤖 PAPER TRADER TICK...");

    // 1. MANAGE ACTIVE POSITIONS (Check TP/SL)
    for (let i = portfolio.positions.length - 1; i >= 0; i--) {
        const pos = portfolio.positions[i];

        // Fetch current price (Simplified: re-analyze gets current price)
        // In production we would just fetch Price ticker for speed
        const analysis = await analyzeCoin(pos.symbol + 'USDT');
        const currentPrice = analysis.price;

        const change = (currentPrice - pos.entryPrice) / pos.entryPrice;

        // CHECK TP
        if (currentPrice >= pos.entryPrice * config.tp) {
            closeTrade(i, currentPrice, 'TAKE PROFIT 🎯');
            continue;
        }

        // CHECK SL
        if (currentPrice <= pos.entryPrice * config.sl) {
            closeTrade(i, currentPrice, 'STOP LOSS 🛑');
            continue;
        }

        // Update Unrealized PNL logic for UI if needed
        portfolio.positions[i].currentPrice = currentPrice;
        portfolio.positions[i].pnl = (change * 100).toFixed(2);
    }

    // 2. SCAN FOR NEW TRADES (If we have cash)
    if (portfolio.balance >= config.tradeSize) {
        // Find best opportunity
        const results = await Promise.all(COINS.map(c => analyzeCoin(c)));

        // --- PURE STATISTICAL STRATEGY ---
        // We only care about "ODDS" (Historical Rebound Chance)
        // Ignoring RSI, MACD, etc.
        const candidates = results.filter(r => {
            const odds = parseFloat(r.indicators.prob); // e.g. 75

            // Criteria:
            // 1. Odds > 60% (Moderate/High Historical Success)
            // 2. Not already in position
            return odds >= 60 && !portfolio.positions.find(p => p.symbol === r.symbol);
        });

        if (candidates.length > 0) {
            // Pick the higest odds
            candidates.sort((a, b) => parseFloat(b.indicators.prob) - parseFloat(a.indicators.prob));
            const best = candidates[0];

            console.log(`🎯 FOUND CANDIDATE: ${best.symbol} (Odds: ${best.indicators.prob})`);

            // OPEN TRADE IMMEDIATELY
            openTrade(best);
        }
    }

    return portfolio;
}

function openTrade(analysis) {
    portfolio.balance -= config.tradeSize;
    const trade = {
        id: Date.now(),
        symbol: analysis.symbol,
        entryPrice: analysis.price,
        amount: config.tradeSize / analysis.price,
        time: new Date().toLocaleTimeString(),
        pnl: 0,
        reason: analysis.reasons[0] || 'High Score'
    };
    portfolio.positions.push(trade);
    console.log(`✅ OPEN TRADE: ${trade.symbol} @ $${trade.entryPrice}`);
}

function closeTrade(index, price, type) {
    const pos = portfolio.positions[index];
    const value = pos.amount * price;
    const profit = value - config.tradeSize;

    portfolio.balance += value;

    const record = {
        ...pos,
        exitPrice: price,
        exitTime: new Date().toLocaleTimeString(),
        profit: profit.toFixed(2),
        type
    };

    portfolio.history.unshift(record);
    portfolio.positions.splice(index, 1);
    console.log(`❎ CLOSE TRADE: ${pos.symbol} (${type}) PNL: $${profit.toFixed(2)}`);
}

export function manualClose(symbol) {
    const idx = portfolio.positions.findIndex(p => p.symbol === symbol);
    if (idx !== -1) {
        // Fetch current price for accurate PNL (mocked here, in real tick it's updated)
        const pos = portfolio.positions[idx];
        closeTrade(idx, pos.currentPrice || pos.entryPrice, 'MANUAL EXIT ✋');
        return true;
    }
    return false;
}
