import { RSI, EMA, BollingerBands } from 'technicalindicators';

/**
 * Analyzes market data to generate a signal
 * @param {Array} candles - Array of candle objects { close: number, ... }
 */
export const analyzePair = (candles) => {
    if (!candles || candles.length === 0) return { signal: 'NEUTRAL', score: 0, prediction: { signal: 'NEUTRAL', color: '#888' } };

    // Always extract price first
    const closes = candles.map(c => c.close);
    const lastPrice = closes[closes.length - 1];

    if (candles.length < 20) {
        return {
            price: lastPrice, // CRITICAL: RETURN PRICE
            signal: 'NEUTRAL',
            prediction: { signal: 'NEUTRAL', label: 'BAJA LIQUIDEZ', color: '#64748B' }
        };
    }

    const currentRSI = RSI.calculate({ values: closes, period: 14 }).slice(-1)[0] || 50;

    // 2. Calculate EMA (200 period - trend) & BB
    const emaValues = EMA.calculate({ period: 200, values: closes });
    const currentEMA = emaValues[emaValues.length - 1] || null;

    // 3. Calculate Bollinger Bands (20 period, 2 stdDev)
    const bbValues = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
    const currentBB = bbValues[bbValues.length - 1] || { upper: lastPrice * 1.05, lower: lastPrice * 0.95 };

    // 4. Logic Engine
    let signal = 'NEUTRAL';
    let label = 'NO OPERAR';
    let color = '#94A3B8';
    let intensity = 0;

    // SNIPER LOGIC (Nivel 2)
    const isOverbought = currentRSI > 70;
    const isOversold = currentRSI < 30;
    const hitLowerBB = lastPrice <= currentBB.lower;
    const hitUpperBB = lastPrice >= currentBB.upper;

    if (isOversold) {
        signal = 'BUY';
        label = 'OFERTA / COMPRA';
        color = '#10B981';
        intensity = 60;

        // CONFLUENCE: Oversold + BB Breakout = Sniper entry
        if (hitLowerBB) {
            signal = 'STRONG_BUY';
            label = '🚨 SNIPER BUY 🚀';
            color = '#00ffaa';
            intensity = 100;
        }
    } else if (isOverbought) {
        signal = 'SELL';
        label = 'SOBRECOMPRA / VENTA';
        color = '#EF4444';
        intensity = 60;

        if (hitUpperBB) {
            signal = 'STRONG_SELL';
            label = '🚨 SNIPER SELL 🔻';
            color = '#ff0055';
            intensity = 100;
        }
    } else {
        // Neutral Zone (30-70)
        if (currentRSI > 50 && lastPrice > currentEMA) {
            signal = 'BULLISH';
            label = 'TENDENCIA ALCISTA ↗';
            color = '#34D399';
            intensity = 40;
        } else if (currentRSI < 50 && lastPrice < currentEMA) {
            signal = 'BEARISH';
            label = 'TENDENCIA BAJISTA ↘';
            color = '#F87171';
            intensity = 40;
        }
    }

    return {
        price: lastPrice,
        ema: currentEMA, // For display
        chartData: {
            ema: emaValues.slice(-50), // For visualization
            bb: bbValues.slice(-50)
        },
        indicators: {
            rsi: currentRSI.toFixed(1),
            ema: currentEMA ? currentEMA.toFixed(2) : '---',
            bb: {
                upper: currentBB.upper.toFixed(2),
                lower: currentBB.lower.toFixed(2)
            }
        },
        prediction: {
            signal,
            label,
            color,
            intensity
        }
    };
};
