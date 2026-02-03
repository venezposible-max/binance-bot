import redis from './utils/redisClient.js';
import axios from 'axios';

export default async function handler(req, res) {
    try {
        // 1. Try to get official list from Redis (Set by check-prices.js)
        const cachedPairs = await redis.get('sentinel_active_pairs');

        if (cachedPairs) {
            return res.status(200).json(JSON.parse(cachedPairs));
        }

        // 2. Fallback: If Redis is empty (Bot hasn't run yet), fetch manually
        console.warn('⚠️ Redis empty for pairs, performing fallback fetch...');
        const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
        const allPairs = response.data;

        // Same logic as check-prices.js
        const BLACKLIST = ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'AEUR', 'EUR', 'GBP', 'PAXG', 'WBTC', 'USD1', 'USDE', 'SUSD', 'FRAX', 'LUSD', 'GUSD', 'FUSD', 'ZAMA', 'ZEC'];
        const relevant = allPairs.filter(p => {
            if (!p.symbol.endsWith('USDT')) return false;
            if (!/^[A-Z0-9]+$/.test(p.symbol)) return false;
            if (BLACKLIST.some(blocked => p.symbol.includes(blocked))) return false;
            return parseFloat(p.quoteVolume) > 5000000;
        });

        relevant.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        const top10 = relevant.slice(0, 10).map(p => p.symbol);

        // Cache it to fix the issue immediately
        await redis.set('sentinel_active_pairs', JSON.stringify(top10));

        return res.status(200).json(top10);

    } catch (error) {
        console.error('❌ Error getting market pairs:', error);
        // Absolute fallback
        res.status(200).json(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'AVAXUSDT', 'LINKUSDT']);
    }
}
