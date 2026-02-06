
import express from 'express';
import axios from 'axios';

const router = express.Router();

const BASE_ASSET = 'USDT';
const FEE = 0.00075; // Using BNB fees (0.075%) is more realistic for arbitrageurs
const TOTAL_FEES = 1 - Math.pow(1 - FEE, 3); // ~0.225%

// Cache to prevent ban
let lastScanParams = {
    timestamp: 0,
    data: []
};

router.get('/scan', async (req, res) => {
    // Rate Limit: Only scan every 5 seconds
    if (Date.now() - lastScanParams.timestamp < 5000) {
        return res.json({
            status: 'cached',
            opportunities: lastScanParams.data,
            timestamp: lastScanParams.timestamp
        });
    }

    try {
        const [tickerRes, volRes] = await Promise.all([
            axios.get('https://api.binance.com/api/v3/ticker/bookTicker'),
            axios.get('https://api.binance.com/api/v3/ticker/24hr')
        ]);

        // 1. Filter by Volume (> 1M USDT to be safe)
        const validSymbols = new Set();
        volRes.data.forEach(t => {
            if (parseFloat(t.quoteVolume) > 1000000) { // 1M Volume Filter
                validSymbols.add(t.symbol);
            }
        });

        const tickers = {};
        tickerRes.data.forEach(t => {
            if (validSymbols.has(t.symbol)) {
                tickers[t.symbol] = {
                    bid: parseFloat(t.bidPrice),
                    ask: parseFloat(t.askPrice),
                    symbol: t.symbol
                };
            }
        });

        const opportunities = [];
        const directPairs = Object.keys(tickers).filter(s => s.endsWith(BASE_ASSET));

        const blacklist = ['BUSD', 'USDC', 'TUSD', 'FDUSD', 'DAI']; // Stablecoins often result in false positives or low liquidity
        for (const pairA of directPairs) {
            const assetA = pairA.replace(BASE_ASSET, '');
            if (blacklist.includes(assetA)) continue;

            const crossPairs = Object.keys(tickers).filter(s => s.endsWith(assetA) || s.startsWith(assetA));

            for (const pairB of crossPairs) {
                if (pairB === pairA) continue;

                // Identify Logic (Simplified for stability)
                let assetB = '';
                let directionB = '';

                if (pairB.endsWith(assetA)) { // Buy B with A
                    assetB = pairB.replace(assetA, '');
                    directionB = 'BUY';
                } else if (pairB.startsWith(assetA)) { // Sell A for B
                    assetB = pairB.substring(assetA.length);
                    directionB = 'SELL';
                }

                if (!assetB || assetB === BASE_ASSET) continue;

                // Check C
                // Check C (B -> USDT)
                let pairC = assetB + BASE_ASSET; // e.g. ETHUSDT
                let directionC = 'SELL';

                // Sometimes it's reverse (rare)
                if (!tickers[pairC]) continue;

                // --- CALC ---
                let current = 100;
                let path = [];

                // 1. USDT -> A (Buy)
                if (!tickers[pairA] || tickers[pairA].ask <= 0) continue;
                current = current / tickers[pairA].ask;
                path.push(`Buy ${assetA} (${tickers[pairA].ask})`);

                // 2. A -> B
                if (directionB === 'BUY') {
                    if (!tickers[pairB] || tickers[pairB].ask <= 0) continue;
                    current = current / tickers[pairB].ask;
                    path.push(`Buy ${assetB} (${tickers[pairB].ask})`);
                } else {
                    if (!tickers[pairB] || tickers[pairB].bid <= 0) continue;
                    current = current * tickers[pairB].bid;
                    path.push(`Sell ${assetA} (${tickers[pairB].bid})`);
                }

                // 3. B -> USDT (Sell)
                if (!tickers[pairC] || tickers[pairC].bid <= 0) continue;
                current = current * tickers[pairC].bid;
                path.push(`Sell ${assetB} (${tickers[pairC].bid})`);

                const profit = ((current - 100) / 100) * 100;
                const net = profit - (TOTAL_FEES * 100);

                if (net > -0.5 && net < 500) { // Show near-misses too (-0.5%) for UI activity
                    opportunities.push({
                        pairA, pairB, pairC,
                        path: `USDT->${assetA}->${assetB}->USDT`,
                        profit: profit.toFixed(3),
                        net: net.toFixed(3),
                        details: path
                    });
                }
            }
        }

        // Sort by Profit
        opportunities.sort((a, b) => b.net - a.net);
        const top10 = opportunities.slice(0, 10);

        lastScanParams = {
            timestamp: Date.now(),
            data: top10
        };

        res.json({ status: 'fresh', opportunities: top10, timestamp: Date.now() });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

export default router;
