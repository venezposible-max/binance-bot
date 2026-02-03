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
 * STRATEGY: BLITZ (The Only Strategy)
 * Fast, Aggressive, Logic-based entry.
 * @param { Object } depth - Order Book depth
        * @param { Array } candles - Price history
            */
export const analyzeBlitz = (depth, candles) => {
    // 1. Run Core Analysis (Order Block + Trend)
    // We inline the relevant parts of analyzeOB here for simplicity/efficiency
    const closes = candles.map(c => c.close || parseFloat(c[4]));
    const lastPrice = closes[closes.length - 1];

    // Indicators
    const emaValues = EMA.calculate({ period: 200, values: closes }) || [];
    const currentEMA = emaValues.length > 0 ? emaValues[emaValues.length - 1] : null;
    const currentRSI = RSI.calculate({ values: closes, period: 14 }).slice(-1)[0] || 50;

    // ATR for TP calculation
    const highs = candles.map(c => c.high || parseFloat(c[2]));
    const lows = candles.map(c => c.low || parseFloat(c[3]));
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }) || [];
    const currentATR = atrValues.length > 0 ? atrValues[atrValues.length - 1] : lastPrice * 0.02;

    // --- LOGIC: ORDER BLOCK SCAN ---
    let obZone = null;
    let foundOB = false;
    let obSignal = 'NEUTRAL';

    // Scan backwards (last 30 candles)
    for (let i = candles.length - 2; i > candles.length - 30 && i > 0; i--) {
        const candle = candles[i];
        const prevCandle = candles[i - 1];
        const close = parseFloat(candle.close || candle[4]);
        const prevOpen = parseFloat(prevCandle.open || prevCandle[1]);
        const prevClose = parseFloat(prevCandle.close || prevCandle[4]);
        const prevHigh = parseFloat(prevCandle.high || prevCandle[2]);
        const prevLow = parseFloat(prevCandle.low || prevCandle[3]);

        // Bullish Impulse?
        const impulse = ((close - prevOpen) / prevOpen) * 100;
        const isBearish = prevClose < prevOpen;

        // BLITZ Threshold: > 0.5% impulse is enough
        if (impulse >= 0.5 && isBearish) {
            const obMid = (prevLow + prevHigh) / 2;
            obZone = {
                low: prevLow,
                high: prevHigh,
                mid: obMid,
                impulse: impulse,
                // BLITZ TARGETS:
                // TP: 2.5x ATR
                // SL: NULL (No Negative Closes)
                tp: lastPrice + (currentATR * 2.5),
                sl: null
            };

            // Signal Logic
            // If price is near OB High or retracing
            if (lastPrice <= obZone.high * 1.01) {
                obSignal = 'BUY';
                foundOB = true;
            }
            break;
        }
    }

    // --- LOGIC: FLOW (Order Book) ---
    // Simplified Flow check
    let flowSignal = 'NEUTRAL';
    let bidPercent = 50;
    let wallPrice = 0;

    if (depth && depth.bids && depth.asks) {
        const topBids = depth.bids.slice(0, 20);
        const bidVol = topBids.reduce((acc, [p, q]) => acc + parseFloat(q), 0);
        const askVol = depth.asks.slice(0, 20).reduce((acc, [p, q]) => acc + parseFloat(q), 0);
        const totalVol = bidVol + askVol;

        bidPercent = totalVol > 0 ? (bidVol / totalVol) * 100 : 50;

        // BLITZ FLOW: Needs > 1.1 ratio (mild buy pressure)
        const ratio = askVol > 0 ? bidVol / askVol : 1;
        if (ratio >= 1.1) flowSignal = 'BUY';

        const masterWall = topBids.sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]))[0];
        wallPrice = masterWall ? parseFloat(masterWall[0]) : 0;
    }

    // --- FINAL CONFLUENCE ---
    let signal = 'NEUTRAL';
    let label = 'ESPERANDO';
    let color = '#94A3B8';
    let intensity = 0;

    // 1. Trend Filter (Relaxed for Blitz: Just allows if not crash)
    // Actually, Blitz is mean reversion too. Checks if price > EMA usually good.
    // User wants simplistic "Blitz".

    if (foundOB && flowSignal === 'BUY') {
        signal = 'STRONG_BUY';
        label = `⚡ BLITZ ENTRY (${bidPercent.toFixed(0)}%)`;
        color = '#F59E0B'; // Amber
        intensity = 90;
    } else if (foundOB) {
        signal = 'BUY';
        label = 'BLITZ (OB ONLY)';
        color = '#10B981';
        intensity = 60;
    }

    return {
        price: lastPrice,
        wallPrice,
        obZone,
        chartData: { ema: emaValues.slice(-50) },
        indicators: {
            rsi: currentRSI.toFixed(1),
            ema: currentEMA ? currentEMA.toFixed(1) : '---',
            flow: { bidPercent: bidPercent.toFixed(1) }
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
