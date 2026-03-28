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
 * STRATEGY: SMART DIP 📉 (Buy The Dip + RSI Confirmation)
 * Looks for significant dips from recent highs with RSI oversold confirmation.
 * Designed for SPOT market: top coins tend to recover from dips.
 * @param { Object } depth - Order Book depth (not used)
 * @param { Array } candles - Price history (1h or 5m candles from Binance API)
 */
export const analyzeSmartDip = (depth, candles) => {
    // Safety check
    if (!candles || candles.length < 30) {
        return {
            price: 0,
            prediction: { signal: 'NEUTRAL', label: 'BAJA LIQUIDEZ', color: '#94A3B8', intensity: 0 },
            indicators: { rsi: '---', dipPercent: '---', high24h: '---' }
        };
    }

    // Extract basic data
    const closes = candles.map(c => c.close || parseFloat(c[4] || 0));
    const highs = candles.map(c => c.high || parseFloat(c[2] || 0));
    const lastPrice = closes[closes.length - 1];

    // --- FASE 1: DETECTAR DIP (Caída desde máximo reciente) ---
    // Últimas 24 velas para calcular el máximo de 24h
    const lookbackHighs = highs.slice(-25, -1);
    const high24h = Math.max(...lookbackHighs);

    // Porcentaje de caída desde el máximo
    const dipPercent = high24h > 0 ? ((lastPrice - high24h) / high24h) * 100 : 0;

    // --- FASE 2: CONFIRMACIÓN RSI (Sobreventa) ---
    const rsiValues = RSI.calculate({ values: closes, period: 14 });
    const currentRSI = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;

    // --- FASE 3: SEÑAL ---
    const isDipping = dipPercent <= -3.0; // Caída de 3% o más
    const isOversold = currentRSI < 35;

    let signal = 'NEUTRAL';
    let label = `OBSERVANDO (Dip: ${dipPercent.toFixed(1)}% | RSI: ${currentRSI.toFixed(0)})`;
    let color = '#94A3B8';
    let intensity = 0;

    if (isDipping && isOversold) {
        signal = 'STRONG_BUY';
        label = `📉 SMART DIP (${dipPercent.toFixed(1)}% | RSI: ${currentRSI.toFixed(0)})`;
        color = '#10B981'; // Green for buy opportunity
        intensity = 100;
    } else if (isDipping && currentRSI < 45) {
        signal = 'BUY';
        label = `📉 DIP DETECTADO (${dipPercent.toFixed(1)}% | RSI: ${currentRSI.toFixed(0)})`;
        color = '#34D399';
        intensity = 60;
    } else if (isOversold) {
        label = `⚠️ RSI BAJO (${currentRSI.toFixed(0)}) pero sin dip suficiente (${dipPercent.toFixed(1)}%)`;
        color = '#F59E0B';
        intensity = 30;
    } else if (dipPercent <= -2.0) {
        label = `👀 DIP MENOR (${dipPercent.toFixed(1)}%) esperando RSI < 35`;
        color = '#64748B';
        intensity = 15;
    }

    return {
        price: lastPrice,
        obZone: {
            isSmartDip: true,
            highWatermark: lastPrice,
            trailingPercent: 1.5
        },
        indicators: {
            rsi: currentRSI.toFixed(1),
            dipPercent: dipPercent.toFixed(2),
            high24h: high24h.toFixed(4),
            ema: '---'
        },
        prediction: {
            signal,
            label,
            color,
            intensity
        }
    };
};

// Keep old name as alias for backward compatibility
export const analyzeVolcano = analyzeSmartDip;

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
