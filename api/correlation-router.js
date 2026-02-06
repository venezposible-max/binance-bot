
import express from 'express';
import axios from 'axios';

const router = express.Router();

// MEMORY BUFFER (To calculate % change over 60s without calling expensive Klines)
// Structure: { 'BTCUSDT': [ { price: 50000, time: 123456789 }, ... ] }
const priceHistory = {};
const WINDOW_SEC = 60; // Look back 60 seconds
const MONITORED_PAIRS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT', 'ADAUSDT',
    'XRPUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'MATICUSDT', 'LTCUSDT'
];

// Helper to clean history
function updateHistory(symbol, price) {
    if (!priceHistory[symbol]) priceHistory[symbol] = [];
    const now = Date.now();
    priceHistory[symbol].push({ price, time: now });

    // Remove old data (> 60s)
    priceHistory[symbol] = priceHistory[symbol].filter(p => now - p.time <= WINDOW_SEC * 1000);
}

function getPercentChange(symbol) {
    if (!priceHistory[symbol] || priceHistory[symbol].length < 2) return 0;
    const history = priceHistory[symbol];
    const oldPrice = history[0].price; // Oldest in window
    const currentPrice = history[history.length - 1].price; // Newest
    return ((currentPrice - oldPrice) / oldPrice) * 100;
}

// Background poller to fill history (Runs every 3 seconds)
setInterval(async () => {
    try {
        const res = await axios.get('https://api.binance.com/api/v3/ticker/price');
        res.data.forEach(t => {
            if (MONITORED_PAIRS.includes(t.symbol)) {
                updateHistory(t.symbol, parseFloat(t.price));
            }
        });
    } catch (e) {
        console.error("Ticker Poll Error", e.message);
    }
}, 3000);

router.get('/scan', (req, res) => {
    // 1. Get BTC Change
    const btcChange = getPercentChange('BTCUSDT');

    // 2. Compare Altcoins
    const opportunities = [];

    MONITORED_PAIRS.forEach(symbol => {
        if (symbol === 'BTCUSDT') return;

        const altChange = getPercentChange(symbol);
        const divergence = btcChange - altChange;

        // LOGIC:
        // BTC UP (+1%), Alt Flat (0%) -> Positive Divergence (Alt SHOULD go up) -> Signal BUY
        // BTC DOWN (-1%), Alt Flat (0%) -> Negative Divergence (Alt SHOULD go down) -> Signal SELL

        let signal = 'NEUTRAL';
        let confidence = 0;

        // Thresholds (PRODUCTION MODE)
        const THRESHOLD = 0.4; // 0.4% Gap (Covers fees + Profit)
        const BTC_MIN_MOVE = 0.2; // BTC must be moving, not flat

        // Only signal if BTC is actually moving
        if (Math.abs(btcChange) > BTC_MIN_MOVE) {
            // BUY Signal: BTC surged, Alt lagging
            if (btcChange > 0 && altChange < (btcChange - THRESHOLD)) {
                signal = 'BUY (LAGGING)';
                confidence = Math.abs(divergence);
            }
            // SELL Signal: BTC dumped, Alt lagging
            else if (btcChange < 0 && altChange > (btcChange + THRESHOLD)) {
                signal = 'SELL (LAGGING)';
                confidence = Math.abs(divergence);
            }
        }

        opportunities.push({
            symbol: symbol.replace('USDT', ''),
            btcChange: btcChange.toFixed(3),
            altChange: altChange.toFixed(3),
            divergence: divergence.toFixed(3),
            signal,
            confidence: confidence.toFixed(2),
            price: priceHistory[symbol]?.[priceHistory[symbol].length - 1]?.price || 0
        });
    });

    // Sort by Confidence (Biggest Gap)
    opportunities.sort((a, b) => b.confidence - a.confidence);

    res.json({
        btcRaw: btcChange.toFixed(3),
        status: btcChange > 0.2 ? 'BTC PUMPING 🚀' : btcChange < -0.2 ? 'BTC DUMPING 🔻' : 'BTC CRAB 🦀',
        opportunities
    });
});

export default router;
