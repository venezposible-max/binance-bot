
import axios from 'axios';
import { calculateForecast } from './src/utils/analysis.js';

const runTest = async () => {
    console.log('🔮 ORACLE TEST: Fetching BTCUSDT Candles (Direct)...');
    try {
        const res = await axios.get('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=100');
        // Convert to object format expected by analysis.js
        const candles = res.data.map(c => ({
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5])
        }));

        console.log(`✅ Fetched ${candles.length} candles.`);
        console.log(`Last Price: $${candles[candles.length - 1].close}`);

        console.log('🧮 Calculating Linear Regression Forecast...');
        const result = calculateForecast(candles, 50, 5); // 50 period, 5 projection

        if (result) {
            console.log('--------- ORACLE RESULT ---------');
            console.log(`Direction: ${result.direction}`);
            console.log(`Slope:     ${result.slope.toFixed(4)}`);
            console.log(`R-Squared: ${result.rSquared} (Confidence)`);
            console.log(`Start Px:  $${result.startPrice.toFixed(2)}`);
            console.log(`Target Px: $${result.endPrice.toFixed(2)}`);
            console.log('---------------------------------');

            // Validate Logic
            const lastClose = candles[candles.length - 1].close;
            const projectedDiff = result.endPrice - lastClose;
            console.log(`Projected Move: $${projectedDiff.toFixed(2)}`);

            console.log('SUCCESS ✅');
        } else {
            console.error('FAILED ❌: No result returned');
        }

    } catch (e) {
        console.error('ERROR:', e.message);
    }
};

runTest();
