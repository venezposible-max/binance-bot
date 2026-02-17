/**
 * BTC GUARD - Market Protection System
 * Analyzes Bitcoin's recent performance to prevent trading during downtrends
 */

import axios from 'axios';

/**
 * Check if BTC is falling (Option 3: Percentage Drop)
 * @returns {Promise<{status: 'SAFE'|'DANGER', btcChange: number, message: string}>}
 */
export async function checkBTCGuardStatus() {
    try {
        // Fetch BTC 2-hour candles from Binance
        const url = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3';
        const response = await axios.get(url, { timeout: 5000 });

        if (!response.data || response.data.length < 3) {
            console.warn('⚠️ BTC GUARD: Insufficient candle data, defaulting to SAFE');
            return { status: 'SAFE', btcChange: 0, message: 'Insufficient data' };
        }

        // Calculate 2-hour percentage change
        const candles = response.data;
        const currentPrice = parseFloat(candles[candles.length - 1][4]); // Close price of latest candle
        const twoHoursAgoPrice = parseFloat(candles[0][1]); // Open price of 2 hours ago

        const percentChange = ((currentPrice - twoHoursAgoPrice) / twoHoursAgoPrice) * 100;

        // THRESHOLD: -1.5% drop in 2 hours
        const DANGER_THRESHOLD = -1.5;

        if (percentChange <= DANGER_THRESHOLD) {
            return {
                status: 'DANGER',
                btcChange: percentChange,
                message: `BTC caída: ${percentChange.toFixed(2)}% (2h)`
            };
        }

        return {
            status: 'SAFE',
            btcChange: percentChange,
            message: `BTC ${percentChange >= 0 ? '+' : ''}${percentChange.toFixed(2)}% (2h)`
        };

    } catch (error) {
        console.error('❌ BTC GUARD ERROR:', error.message);
        // On error, default to SAFE to avoid blocking trades unnecessarily
        return { status: 'SAFE', btcChange: 0, message: 'Error fetching data' };
    }
}
