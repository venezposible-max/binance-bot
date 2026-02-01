
import axios from 'axios';
import * as analysis from './src/utils/analysis.js';

// Replicating the logic from check-prices.js
async function getDynamicTopPairs() {
    try {
        console.log('🔄 Fetching Top 10 Pairs by Volume...');
        // Try Global first
        let baseUrl = 'https://api.binance.com';
        let res;
        try {
            res = await axios.get(`${baseUrl}/api/v3/ticker/24hr`, { timeout: 5000 });
        } catch (e) {
            console.log('   Global API failed, trying US...');
            baseUrl = 'https://api.binance.us';
            res = await axios.get(`${baseUrl}/api/v3/ticker/24hr`, { timeout: 5000 });
        }

        const allPairs = res.data;
        const BLACKLIST = ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'AEUR', 'EUR', 'GBP', 'PAXG', 'WBTC'];

        const relevant = allPairs.filter(p => {
            if (!p.symbol.endsWith('USDT')) return false;
            if (BLACKLIST.some(blocked => p.symbol.includes(blocked))) return false;
            // Volume Filter (> 5M)
            return parseFloat(p.quoteVolume) > 5000000;
        });

        relevant.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        return relevant.slice(0, 10).map(p => p.symbol);
    } catch (e) {
        console.warn('⚠️ Dynamic Pair Fetch Failed, using fallback:', e.message);
        return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT', 'ADAUSDT', 'TRXUSDT', 'AVAXUSDT', 'LINKUSDT'];
    }
}

async function analyzeSymbol(symbol) {
    try {
        // 1. Fetch Candles
        let klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=250`;
        let klines;
        try {
            const res = await axios.get(klinesUrl);
            klines = res.data;
        } catch (e) {
            klinesUrl = `https://api.binance.us/api/v3/klines?symbol=${symbol}&interval=1m&limit=250`;
            const res = await axios.get(klinesUrl);
            klines = res.data;
        }

        const processedKlines = klines.map(c => ({
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5])
        }));

        // 2. Fetch Depth
        let depthUrl = `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=50`;
        let depth;
        try {
            const res = await axios.get(depthUrl);
            depth = res.data;
        } catch (e) {
            depthUrl = `https://api.binance.us/api/v3/depth?symbol=${symbol}&limit=50`;
            const res = await axios.get(depthUrl);
            depth = res.data;
        }

        // 3. Analyze
        const result = await analysis.analyzeHybrid(depth, processedKlines, { mode: 'BLITZ' });

        // Calcs for Report
        const lastCandle = processedKlines[processedKlines.length - 1];
        const prevCandle = processedKlines[processedKlines.length - 2];
        const impulse = ((lastCandle.close - prevCandle.open) / prevCandle.open) * 100;

        const bids = depth.bids.map(b => parseFloat(b[1])).reduce((a, b) => a + b, 0);
        const asks = depth.asks.map(b => parseFloat(b[1])).reduce((a, b) => a + b, 0);
        const buyPressure = bids / asks;

        return {
            symbol,
            price: lastCandle.close,
            impulse: impulse.toFixed(3),
            flow: buyPressure.toFixed(2),
            signal: result.prediction.signal,
            label: result.prediction.label
        };

    } catch (e) {
        return { symbol, error: e.message };
    }
}

async function testBlitz() {
    console.log(`\n🔍 DIAGNOSTIC: Checking BLITZ Mode Conditions for TOP 10 PAIRS...\n`);
    const pairs = await getDynamicTopPairs();
    console.log(`📋 Scanning: ${pairs.join(', ')}\n`);

    console.log('Symbol       | Price       | Impulse (0.5%) | Flow (1.1x) | Status');
    console.log('-----------------------------------------------------------------------');

    for (const symbol of pairs) {
        const data = await analyzeSymbol(symbol);
        if (data.error) {
            console.log(`${symbol.padEnd(12)} | ERROR: ${data.error}`);
            continue;
        }

        const implStatus = parseFloat(data.impulse) >= 0.5 ? '✅' : '❌';
        const flowStatus = parseFloat(data.flow) >= 1.1 ? '✅' : '❌';
        const final = data.signal === 'STRONG_BUY' ? '🚀 BUY' : '💤 WAIT';

        console.log(`${symbol.padEnd(12)} | $${data.price.toString().padEnd(9)} | ${data.impulse}% ${implStatus}   | ${data.flow}x ${flowStatus}   | ${final}`);
    }
    console.log('\n-----------------------------------------------------------------------\n');
}

testBlitz();
