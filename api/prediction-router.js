
import express from 'express';
import axios from 'axios';
import { RSI, MACD, BollingerBands, EMA, Stochastic } from 'technicalindicators';

const router = express.Router();

const COINS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'
];

export async function analyzeCoin(symbol) {
    // 1. Fetch Candles (4h timeframe is best for "Predictions")
    const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=200`);
    const candles = res.data;

    // Parse Data needed for TA
    const closes = candles.map(c => parseFloat(c[4]));
    const highs = candles.map(c => parseFloat(c[2]));
    const lows = candles.map(c => parseFloat(c[3]));
    const currentPrice = closes[closes.length - 1];

    // 2. Calculate Indicators

    // RSI (14)
    const rsiRaw = RSI.calculate({ period: 14, values: closes });
    const rsi = rsiRaw[rsiRaw.length - 1];

    // MACD (12, 26, 9)
    const macdRaw = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    });
    const macd = macdRaw[macdRaw.length - 1];

    // EMA (50 & 200)
    const ema50Raw = EMA.calculate({ period: 50, values: closes });
    const ema200Raw = EMA.calculate({ period: 200, values: closes });
    const ema50 = ema50Raw[ema50Raw.length - 1];
    const ema200 = ema200Raw[ema200Raw.length - 1];

    // Bollinger Bands (20, 2)
    const bbRaw = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    const bb = bbRaw[bbRaw.length - 1];

    // 3. THE VERDICT ALGORITHM ⚖️
    let score = 0;
    let reasons = [];

    // --- NEW: STATISTICAL PATTERN MATCHING ("Rebound Chance") ---
    // 1. Identify Current Pattern (e.g. "Last 3 candles were RED")
    let redStreak = 0;
    let greenStreak = 0;
    for (let i = closes.length - 1; i >= 0; i--) {
        if (closes[i] < closes[i - 1]) { // RED
            if (greenStreak > 0) break;
            redStreak++;
        } else { // GREEN
            if (redStreak > 0) break;
            greenStreak++;
        }
    }

    // 2. Scan History for this Pattern
    let bounceCount = 0;
    let continueCount = 0;
    const LOOKBACK = 200; // Look at last 200 candles

    // We look for previous times we had exactly this Streak
    const targetStreak = redStreak > 0 ? redStreak : greenStreak;
    const isRed = redStreak > 0;

    for (let i = 50; i < closes.length - 1; i++) {
        // fast check: verify if candle[i] matches the streak end
        let match = true;
        // Verify backward streak
        for (let j = 0; j < targetStreak; j++) {
            const c = closes[i - j];
            const o = parseFloat(candles[i - j][1]); // open
            const prevC = closes[i - j - 1];

            // Simplified Red/Green check based on Close vs Prev Close
            const candleIsRed = c < prevC;
            if (isRed !== candleIsRed) { match = false; break; }
        }

        if (match) {
            // Check What Happened NEXT (i + 1)
            const nextClose = closes[i + 1];
            const currentClose = closes[i];

            if (isRed) {
                // We are dropping. Did we bounce (Green)?
                if (nextClose > currentClose) bounceCount++;
                else continueCount++;
            } else {
                // We are rising. Did we reject (Red)?
                if (nextClose < currentClose) bounceCount++; // Rejection (Reverse)
                else continueCount++; // Continuation
            }
        }
    }

    const totalMatches = bounceCount + continueCount;
    const reboundProb = totalMatches > 0 ? (bounceCount / totalMatches) * 100 : 50;

    // Add to Score if Probability is High
    if (isRed && reboundProb > 65) {
        score += 2;
        reasons.push(`Alta Probabilidad de Rebote (${reboundProb.toFixed(0)}%) tras ${redStreak} Velas Rojas`);
    }
    else if (!isRed && reboundProb > 65) {
        score -= 2;
        reasons.push(`Alta Probabilidad de Rechazo (${reboundProb.toFixed(0)}%) tras ${greenStreak} Velas Verdes`);
    }

    // --- EXISTING INDICATORS ---

    // RSI Logic
    if (rsi < 30) { score += 2; reasons.push('RSI Oversold (Cheap)'); }
    else if (rsi > 70) { score -= 2; reasons.push('RSI Overbought (Expensive)'); }
    else if (rsi > 50) { score += 0.5; } // Mild Bullish

    // MACD Logic
    if (macd.histogram > 0) { score += 1.5; reasons.push('MACD Bullish Momentum'); }
    else { score -= 1.5; reasons.push('MACD Bearish Momentum'); }

    // Trend Logic (EMA)
    if (currentPrice > ema200) { score += 1; reasons.push('Above EMA200 (Uptrend)'); }
    else { score -= 2; reasons.push('Below EMA200 (Downtrend)'); } // Don't fight the trend

    // Golden Cross Check (EMA50 > EMA200)
    if (ema50 > ema200) { score += 1; reasons.push('Golden Cross Active'); }

    // Bollinger Logic
    if (currentPrice < bb.lower) { score += 2; reasons.push('Below Lower BB (Bounce Likely)'); }
    else if (currentPrice > bb.upper) { score -= 2; reasons.push('Above Upper BB (Correction Likely)'); }

    // Classification
    let verdict = 'NEUTRAL';
    if (score >= 4) verdict = '🚀 STRONG BUY';
    else if (score >= 2) verdict = '🟢 BUY';
    else if (score <= -4) verdict = '🩸 STRONG SELL';
    else if (score <= -2) verdict = '🔴 SELL';

    return {
        symbol: symbol.replace('USDT', ''),
        price: currentPrice,
        score: score.toFixed(1),
        verdict,
        indicators: {
            rsi: rsi.toFixed(1),
            macd: macd.histogram > 0 ? 'bull' : 'bear',
            trend: currentPrice > ema200 ? 'bull' : 'bear',
            pattern: isRed ? `${redStreak} 🔻` : `${greenStreak} 🟢`,
            prob: reboundProb.toFixed(0) + '%'
        },
        reasons
    };
}

router.get('/scan', async (req, res) => {
    try {
        const results = await Promise.all(COINS.map(c => analyzeCoin(c)));

        // Sort by Score (Best Buys first)
        results.sort((a, b) => b.score - a.score);

        res.json({ status: 'success', data: results });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

export default router;
