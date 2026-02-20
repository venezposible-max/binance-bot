import { RSI, EMA, BollingerBands, ATR, ADX } from 'technicalindicators';

/**
 * Analyzes market data to generate a signal
 * @param {Array} candles - Array of candle objects { close: number, ... }
 */
export const analyzePair = (candles, config = {}) => {
    // Always extract price first
    const closes = (candles || []).map(c => c.close || parseFloat(c[4] || 0));
    const lastPrice = closes.length > 0 ? closes[closes.length - 1] : 0;

    // SKELETON: Constant structure to prevent UI crashes
    const skeleton = {
        price: lastPrice,
        ema: null,
        chartData: { ema: [], bb: [] },
        indicators: { rsi: '---', ema: '---', bb: { upper: '---', lower: '---' } },
        prediction: { signal: 'NEUTRAL', label: 'CARGANDO', color: '#94A3B8', intensity: 0 }
    };

    if (!candles || candles.length === 0) {
        return { ...skeleton, prediction: { ...skeleton.prediction, label: 'SIN DATOS' } };
    }

    const swingMode = config?.swingMode || 'CONSERVATIVE';

    if (candles.length < 20) {
        return { ...skeleton, prediction: { ...skeleton.prediction, label: 'BAJA LIQUIDEZ' } };
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
    const topBids = depth.bids.slice(0, 20);
    const bidVol = topBids.reduce((acc, [p, q]) => acc + parseFloat(q), 0);
    const askVol = depth.asks.slice(0, 20).reduce((acc, [p, q]) => acc + parseFloat(q), 0);

    // Identify Master Wall (Highest Volume Bid)
    let masterWall = { price: 0, volume: 0 };
    topBids.forEach(([price, qty]) => {
        const v = parseFloat(qty);
        if (v > masterWall.volume) masterWall = { price: parseFloat(price), volume: v };
    });

    const buyPressure = askVol > 0 ? bidVol / askVol : 1;
    const totalVol = bidVol + askVol;
    const bidPercent = (bidVol / totalVol) * 100;

    // Indicators for visual consistency
    const emaValues = EMA.calculate({ period: 200, values: closes }) || [];
    const currentEMA = emaValues.length > 0 ? emaValues[emaValues.length - 1] : null;
    const currentRSI = RSI.calculate({ values: closes, period: 14 }).slice(-1)[0] || 50;

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
        wallPrice: masterWall.price,
        chartData: {
            ema: emaValues.slice(-50)
        },
        indicators: {
            rsi: currentRSI.toFixed(1),
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
 * STRATEGY: SENTINEL VORTEX (Evolution of Vortex)
 * Accuracy focalized on Extreme Exhaustion (RSI 2) + Heikin Ashi Confirmation.
 * @param { Object } depth - Order Book depth
 * @param { Array } candles - Price history
 */
export const analyzeVortex = (depth, candles) => {
    const closes = candles.map(c => c.close || parseFloat(c[4]));
    const opens = candles.map(c => c.open || parseFloat(c[1]));
    const highs = candles.map(c => c.high || parseFloat(c[2]));
    const lows = candles.map(c => c.low || parseFloat(c[3]));
    const lastPrice = closes[closes.length - 1];

    // --- INDICATORS: VORTEX CORE ---
    // 1. RSI 2 (Sensitivity Extreme)
    const rsi2Values = RSI.calculate({ values: closes, period: 2 }) || [];
    const currentRSI2 = rsi2Values.length > 0 ? rsi2Values[rsi2Values.length - 1] : 50;

    // 2. HEIKIN ASHI CALCULATION
    const haCandles = [];
    for (let i = 0; i < candles.length; i++) {
        const o = opens[i];
        const h = highs[i];
        const l = lows[i];
        const c = closes[i];

        const haClose = (o + h + l + c) / 4;
        let haOpen = 0;

        if (i === 0) {
            haOpen = (o + c) / 2;
        } else {
            const prevHa = haCandles[i - 1];
            haOpen = (prevHa.open + prevHa.close) / 2;
        }

        const haHigh = Math.max(h, haOpen, haClose);
        const haLow = Math.min(l, haOpen, haClose);

        haCandles.push({ open: haOpen, close: haClose, high: haHigh, low: haLow });
    }

    const lastHA = haCandles[haCandles.length - 1];
    const prevHA = haCandles[haCandles.length - 2];

    // 3. ATR for Dynamic TP
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }) || [];
    const currentATR = atrValues.length > 0 ? atrValues[atrValues.length - 1] : lastPrice * 0.02;

    // --- LOGIC: VORTEX SIGNALS ---
    // EXHAUSTION = RSI(2) < 5
    // CONFIRMATION = Green Heikin Ashi (Close > Open) + No Lower Wick (Low == Open)
    const isExhausted = currentRSI2 < 5;
    const isHAConfirmation = lastHA.close > lastHA.open && (Math.abs(lastHA.low - lastHA.open) < (lastHA.high - lastHA.low) * 0.05);

    let signal = 'NEUTRAL';
    let label = 'ESPERANDO';
    let color = '#94A3B8';
    let intensity = 0;

    // TP Calculation (ATR based from Vortex)
    // 2.5x ATR with 0.6% ROI protective floor for fees
    let rawTarget = lastPrice + (currentATR * 2.5);
    let targetPrice = Math.max(rawTarget, lastPrice * 1.006);

    const vortexZone = {
        tp: targetPrice,
        sl: null, // No SL as requested for Spot
        rsi2: currentRSI2,
        isHA: isHAConfirmation,
        atr: currentATR
    };

    if (isExhausted) {
        signal = 'BUY';
        label = `VORTEX AGOTAMIENTO (${currentRSI2.toFixed(1)}%)`;
        color = '#10B981';
        intensity = 60;
    }

    if (isExhausted && isHAConfirmation) {
        signal = 'STRONG_BUY';
        label = `⚡ SENTINEL VORTEX ⚡`;
        color = '#F59E0B';
        intensity = 100;
    }

    // Standard RSI 14 for context only
    const currentRSI14 = RSI.calculate({ values: closes, period: 14 }).slice(-1)[0] || 50;

    return {
        price: lastPrice,
        obZone: vortexZone, // Reusing key to avoid breaking scanner
        indicators: {
            rsi: currentRSI14.toFixed(1),
            rsi2: currentRSI2.toFixed(1),
            volatility: ((currentATR / lastPrice) * 100).toFixed(2),
            hybrid: { odds: 50 } // Hybrid logic can be kept or removed, keeping for compact
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
 * STRATEGY: UNIXA (Precision Extreme)
 * Same as Vortex but with RSI(2) < 2 for near-perfect entries.
 */
export const analyzeUnixa = (depth, candles) => {
    const analysis = analyzeVortex(depth, candles);
    const rsi2 = parseFloat(analysis.indicators.rsi2);

    // Override signal for UNIXA
    if (rsi2 < 2.0) {
        analysis.prediction.signal = 'STRONG_BUY';
        analysis.prediction.label = `⚡ UNIXA ENTRY (${rsi2.toFixed(1)}%) ⚡`;
        analysis.prediction.color = '#F59E0B';
        analysis.prediction.intensity = 100;

        // UNIXA OPTIMAL CONFIG #1: TP = 2.0x ATR (vs 2.5x from Vortex)
        if (analysis.obZone && analysis.obZone.atr) {
            const rawTarget = analysis.price + (analysis.obZone.atr * 2.0);
            analysis.obZone.tp = Math.max(rawTarget, analysis.price * 1.004); // Min 0.4% per optimizer
        }
    } else {
        analysis.prediction.signal = 'NEUTRAL';
        analysis.prediction.label = 'ESPERANDO UNIXA';
        analysis.prediction.color = '#94A3B8';
        analysis.prediction.intensity = 0;
    }

    return analysis;
};

/**
 * PHASE 7: FORECAST (Visual Only)
 * Kept for UI Chart
 */
export const calculateForecast = (candles, period = 50, projection = 5) => {
    if (!candles || candles.length < period) return null;
    const slice = candles.slice(-period);
    const n = slice.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

    for (let i = 0; i < n; i++) {
        const x = i;
        const y = slice[i].close || parseFloat(slice[i][4]);
        sumX += x; sumY += y; sumXY += (x * y); sumXX += (x * x);
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Standard deviation for bands
    const avgY = sumY / n;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < n; i++) {
        const x = i;
        const y = slice[i].close || parseFloat(slice[i][4]);
        const predY = slope * x + intercept;
        ssTot += Math.pow(y - avgY, 2);
        ssRes += Math.pow(y - predY, 2);
    }
    const rSquared = 1 - (ssRes / ssTot);
    const stdDev = Math.sqrt(ssRes / (n - 2));

    const forecastPoints = [];
    for (let i = 0; i <= projection; i++) {
        const x = n - 1 + i;
        const p = slope * x + intercept;
        forecastPoints.push({
            index: x, price: p,
            upper1: p + stdDev, lower1: p - stdDev,
            upper2: p + 2 * stdDev, lower2: p - 2 * stdDev
        });
    }

    return { slope, intercept, stdDev, rSquared: rSquared.toFixed(2), points: forecastPoints };
};
