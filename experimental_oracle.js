
import axios from 'axios';

// --- THE SACRED CONSTANTS ---
const PHI = 1.61803398875; // The Golden Ratio (Growth)
const PI = 3.14159265359;  // The Cycle of Time (Circle)
const EULER = 2.71828;     // Natural Decay/Growth

// --- CONFIG ---
const PAIR = 'BTCUSDT';
const TIMEFRAME = '4h'; // Divine Timeframe

// --- THE ALGORITHM: "CHRONOS-PHI" ---
// Theory: Markets move in spirals defined by PHI (Price) and PI (Time).
async function consultTheOracle() {
    console.log(`🔮 CONSULTING THE CHRONOS-PHI ORACLE FOR ${PAIR}...`);

    // 1. Fetch Reality (Market Data)
    const url = `https://api.binance.com/api/v3/klines?symbol=${PAIR}&interval=${TIMEFRAME}&limit=100`;
    const res = await axios.get(url);
    const candles = res.data;

    // Get the "Seed" (Last significant High/Low)
    // We look for the biggest swing in the last 100 candles
    let highest = -Infinity, lowest = Infinity;
    let highIdx = 0, lowIdx = 0;

    candles.forEach((c, i) => {
        const h = parseFloat(c[2]);
        const l = parseFloat(c[3]);
        if (h > highest) { highest = h; highIdx = i; }
        if (l < lowest) { lowest = l; lowIdx = i; }
    });

    const currentPrice = parseFloat(candles[candles.length - 1][4]);

    console.log(`\n🌌 SEED DATA:`);
    console.log(`High: $${highest} (Index ${highIdx})`);
    console.log(`Low:  $${lowest} (Index ${lowIdx})`);
    console.log(`Current: $${currentPrice}`);

    // 2. CALCULATE PRICE TARGETS (The Golden Ladder)
    // We project from the Low to the High (or vice versa)
    const range = highest - lowest;
    const goldenExtension = highest + (range * 0.618);
    const divineTarget = highest + (range * 1.618);
    const piTarget = highest * (1 + (PI / 100)); // Price + 3.14%

    // 3. CALCULATE TIME CYCLES (The Pi Votex)
    // Markets tend to turn every PI * 10 candles? Let's use Euler decay.
    // Prediction: Next significant move is in X candles.
    const lastSignificantTime = highIdx > lowIdx ? candles[highIdx][0] : candles[lowIdx][0];
    const timeDelta = Date.now() - lastSignificantTime;
    const cycleDuration = timeDelta * (PHI - 1); // 0.618 of the last move duration
    const predictionTime = Date.now() + cycleDuration;

    console.log(`\n📜 THE PROPHECY (Future Prediction):`);

    console.log(`\n1. PRICE TARGETS (Resistances):`);
    console.log(`   ✨ Golden Target (1.618): $${divineTarget.toFixed(2)}`);
    console.log(`   🌀 Fibonacci Level (0.618): $${goldenExtension.toFixed(2)}`);
    console.log(`   🥧 Pi Resistance (+3.14%): $${piTarget.toFixed(2)}`);

    console.log(`\n2. TIME HORIZON (When?):`);
    console.log(`   ⏳ The Vortex turns at: ${new Date(predictionTime).toISOString()}`);
    console.log(`   (Calculated using Golden Decay of the last volatility swing)`);

    // 4. THE SENTIMENT (Euler's Decay)
    // Is the momentum decaying?
    const momentum = (currentPrice - lowest) / range; // 0 to 1
    const naturalOrder = 1 / EULER; // 0.367

    console.log(`\n3. COSMIC ALIGNMENT:`);
    if (momentum > (1 - naturalOrder)) {
        console.log(`   🐂 BULLISH (Momentum > Decay). The Spiral expands up.`);
    } else {
        console.log(`   🐻 BEARISH (Momentum < Decay). The Spiral collapses in.`);
    }
}

consultTheOracle();
