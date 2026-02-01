import { RSI, EMA, BollingerBands } from 'technicalindicators';

/**
 * Analyzes market data to generate a signal
 * @param {Array} candles - Array of candle objects { close: number, ... }
 */
export const analyzePair = (candles, config = {}) => {
    if (!candles || candles.length === 0) return { signal: 'NEUTRAL', score: 0, prediction: { signal: 'NEUTRAL', color: '#888' } };

    const swingMode = config.swingMode || 'CONSERVATIVE'; // NEW: Default to safe

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

    const trendFilter = swingMode === 'CONSERVATIVE' ? (lastPrice > currentEMA) : true;

    if (isOversold && trendFilter) {
        signal = 'BUY';
        label = 'OFERTA / COMPRA';
        color = '#10B981';
        intensity = 60;

        // CONFLUENCE: Oversold + BB Breakout + Bullish Trend = Sniper entry
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

/**
 * STRATEGY: FLOW (Order Book Imbalance)
 * Ignores technicals. Looks for Walls and Pressure.
 * @param {Object} depth - { bids: [[price, qty], ...], asks: [...] }
 * @param {Array} candles - Price history candles
 */
export const analyzeFlow = (depth, candles) => {
    const closes = candles.map(c => c.close);
    const lastPrice = closes[closes.length - 1] || 0;

    if (!depth || !depth.bids || !depth.asks) {
        return {
            price: lastPrice,
            indicators: {
                rsi: '---',
                ema: '---',
                flow: { bidVol: '0', askVol: '0', ratio: '1.00', bidPercent: '50.0' }
            },
            prediction: {
                signal: 'NEUTRAL',
                label: 'NO DATA (FLOW)',
                color: '#64748B',
                intensity: 0
            }
        };
    }

    // 1. Calculate Buying Pressure (Sum of Bid Volume) vs Selling Pressure
    const bidVol = depth.bids.slice(0, 20).reduce((acc, [p, q]) => acc + parseFloat(q), 0);
    const askVol = depth.asks.slice(0, 20).reduce((acc, [p, q]) => acc + parseFloat(q), 0);

    const buyPressure = askVol > 0 ? bidVol / askVol : 1;
    const totalVol = bidVol + askVol;
    const bidPercent = (bidVol / totalVol) * 100;

    // EMA for visual trend
    const emaValues = EMA.calculate({ period: 200, values: closes }) || [];
    const currentEMA = emaValues.length > 0 ? emaValues[emaValues.length - 1] : null;

    let signal = 'NEUTRAL';
    let label = 'EQUILIBRIO FLOW';
    let color = '#94A3B8';
    let intensity = 0;

    if (buyPressure >= 2.0) {
        signal = 'STRONG_BUY';
        label = `🌊 MURO DE COMPRA (${bidPercent.toFixed(0)}%)`;
        color = '#00ffaa';
        intensity = 100;
    } else if (buyPressure >= 1.5) {
        signal = 'BUY';
        label = `PRESION ALCISTA (${bidPercent.toFixed(0)}%)`;
        color = '#10B981';
        intensity = 60;
    } else if (buyPressure <= 0.5) {
        signal = 'STRONG_SELL';
        label = `🧱 MURO DE VENTA (${(100 - bidPercent).toFixed(0)}%)`;
        color = '#EF4444';
        intensity = 100;
    } else if (buyPressure <= 0.75) {
        signal = 'SELL';
        label = `PRESION BAJISTA (${(100 - bidPercent).toFixed(0)}%)`;
        color = '#F87171';
        intensity = 60;
    }

    return {
        price: lastPrice,
        chartData: {
            ema: emaValues.slice(-50)
        },
        indicators: {
            rsi: '---',
            ema: currentEMA ? currentEMA.toFixed(2) : '---',
            flow: {
                bidVol: bidVol.toFixed(2),
                askVol: askVol.toFixed(2),
                ratio: buyPressure.toFixed(2),
                bidPercent: bidPercent.toFixed(1)
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

/**
 * STRATEGY: TRIPLE LOUPE (15m + 1h + 4h)
 * @param {Array} k4h - 4h Candles
 * @param {Array} k1h - 1h Candles
 * @param {Array} k15m - 15m Candles
 */
export const analyzeTriple = (k4h, k1h, k15m) => {
    const c4h = k4h.map(c => c.close);
    const c1h = k1h.map(c => c.close);
    const c15m = k15m.map(c => c.close);

    const r4h = RSI.calculate({ values: c4h, period: 14 }).slice(-1)[0] || 50;
    const r1h = RSI.calculate({ values: c1h, period: 14 }).slice(-1)[0] || 50;
    const r15m = RSI.calculate({ values: c15m, period: 14 }).slice(-1)[0] || 50;

    const lastPrice = c4h[c4h.length - 1];
    const isStrongBuy = (r4h < 30 && r1h < 30 && r15m < 30);

    // EMA for visual trend (using 4h)
    const emaValues = EMA.calculate({ period: 200, values: c4h }) || [];
    const currentEMA = emaValues.length > 0 ? emaValues[emaValues.length - 1] : null;

    return {
        price: lastPrice,
        chartData: {
            ema: emaValues.slice(-50)
        },
        indicators: {
            rsi: r4h.toFixed(1),
            rsi1h: r1h.toFixed(1),
            rsi15m: r15m.toFixed(1),
            ema: currentEMA ? currentEMA.toFixed(1) : '---'
        },
        prediction: {
            signal: isStrongBuy ? 'STRONG_BUY' : 'NEUTRAL',
            label: isStrongBuy ? '🚨 TRIPLE CONFIRMED 🚀' : 'ESPERANDO ALINEACIÓN',
            color: isStrongBuy ? '#00ffaa' : '#64748B',
            intensity: isStrongBuy ? 100 : 0
        }
    };
};

