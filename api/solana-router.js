
import express from 'express';
import axios from 'axios';

const router = express.Router();

// CACHE
let cache = {
    timestamp: 0,
    data: []
};

// LIST OF MEMES & SOLANA ECOSYSTEM ON BINANCE
const TARGET_COINS = [
    'SOLUSDT', 'WIFUSDT', 'BONKUSDT', 'BOMEUSDT', 'JUPUSDT', 'RAYUSDT',
    'PYTHUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'MEMEUSDT', 'SHIBUSDT', 'DOGEUSDT',
    'ORDIUSDT', 'SATSUSDT', 'RUNEUSDT', 'INJUSDT'
];

router.get('/scan', async (req, res) => {
    try {
        const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr');

        const gems = response.data
            .filter(t => TARGET_COINS.includes(t.symbol))
            .map(t => ({
                name: t.symbol.replace('USDT', ''), // Simplified name
                symbol: t.symbol,
                price: parseFloat(t.lastPrice),
                liquidity: parseFloat(t.quoteVolume), // Using 24h Volume as liquidity proxy
                volume: parseFloat(t.quoteVolume),
                change5m: parseFloat(t.priceChangePercent), // Note: This is 24h change, Binance doesn't give 5m here freely without klines.
                // To get real "Momentum", 24h change is okay for a general view.
                url: `https://www.binance.com/en/trade/${t.symbol}?type=spot`
            }));

        // Sort by Performance (Winners first)
        gems.sort((a, b) => b.change5m - a.change5m);

        res.json({ status: 'fresh', data: gems });

    } catch (e) {
        console.error("Binance Error:", e.message);
        res.status(500).json({ error: "Failed to fetch Binance Data" });
    }
});

export default router;
