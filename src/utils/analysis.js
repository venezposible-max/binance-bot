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

/**
 * STRATEGY: ORDER BLOCKS (OB)
 * Detects institutional zones and reversals.
 * @param {Array} candles
 * @param {Object} config - { mode: 'SWING' | 'BLITZ' }
 */
export const analyzeOB = (candles, config = {}) => {
    const isBlitz = config.mode === 'BLITZ';
    if (!candles || candles.length < 10) {
        return {
            price: 0,
            prediction: { signal: 'NEUTRAL', label: 'CARGANDO OB' }
        };
    }

    const lastCandle = candles[candles.length - 1];
    const lastPrice = lastCandle.close || parseFloat(lastCandle[4]);

    // 🚀 INITIALIZE INDICATORS FIRST (Fix ReferenceError)
    const closes = candles.map(c => c.close || parseFloat(c[4]));
    const highs = candles.map(c => c.high || parseFloat(c[2]));
    const lows = candles.map(c => c.low || parseFloat(c[3]));

    const emaValues = EMA.calculate({ period: 200, values: closes }) || [];
    const currentEMA = emaValues.length > 0 ? emaValues[emaValues.length - 1] : null;
    const currentRSI = RSI.calculate({ values: closes, period: 14 }).slice(-1)[0] || 50;

    // Phase 3: ATR for Volatility-adjusted Risk
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }) || [];
    const currentATR = atrValues.length > 0 ? atrValues[atrValues.length - 1] : lastPrice * 0.02;

    let obZone = null;
    let signal = 'NEUTRAL';
    let label = 'BUSCANDO ZONA';
    let color = '#94A3B8';
    let intensity = 0;

    // Scan backwards for a bullish Order Block (Impulse + Bearish Candle)
    // We look at the last 30 candles to find the most recent valid zone
    for (let i = candles.length - 2; i > candles.length - 30 && i > 0; i--) {
        const candle = candles[i];
        const prevCandle = candles[i - 1];

        const open = parseFloat(candle.open || candle[1]);
        const close = parseFloat(candle.close || candle[4]);
        const low = parseFloat(candle.low || candle[3]);
        const high = parseFloat(candle.high || candle[2]);

        const prevOpen = parseFloat(prevCandle.open || prevCandle[1]);
        const prevClose = parseFloat(prevCandle.close || prevCandle[4]);
        const prevHigh = parseFloat(prevCandle.high || prevCandle[2]);
        const prevLow = parseFloat(prevCandle.low || prevCandle[3]);

        // 1. Check for Bullish Impulse (current candle closed > prev open)
        const impulse = ((close - prevOpen) / prevOpen) * 100;
        const isBearish = prevClose < prevOpen;

        const impulseThreshold = isBlitz ? 0.8 : 2.0; // TURBO: Lower impulse for Blitz

        if (impulse >= impulseThreshold && isBearish) {
            // Found a bullish OB Zone: prevLow to prevHigh
            const obMid = (prevLow + prevHigh) / 2; // 50% EQUILIBRIUM

            obZone = {
                low: prevLow,
                high: prevHigh,
                mid: obMid,
                impulse: impulse,
                // Phase 3: ATR-Based Dynamic Targets
                tp: lastPrice + (currentATR * 2.5), // 2.5x ATR for target
                sl: lastPrice - (currentATR * 1.5)  // 1.5x ATR for safety
            };

            // 2. Expert Logic: Check Trend + Precision Entry
            const isTrendBulish = lastPrice > (currentEMA || 0);
            const isAtMidpoint = lastPrice >= obZone.low && lastPrice <= obMid;

            if (isTrendBulish && isAtMidpoint) {
                signal = 'BUY';
                label = `🎯 EXPERT OB (+${impulse.toFixed(1)}%)`;
                color = '#10B981';
                intensity = 90;
            } else if (!isTrendBulish) {
                signal = 'NEUTRAL';
                label = 'FILTRO EMA (ESPERANDO)';
                color = '#EF4444';
                intensity = 20;
            } else {
                signal = 'BULLISH';
                label = 'OB DETECTADO (BUSCANDO MID)';
                color = '#34D399';
                intensity = 50;
            }
            break; // Stop at first (most recent) OB found
        }
    }

    return {
        price: lastPrice,
        obZone,
        chartData: {
            ema: emaValues.slice(-50)
        },
        indicators: {
            rsi: currentRSI.toFixed(1),
            ema: currentEMA ? currentEMA.toFixed(1) : '---',
            atr: currentATR.toFixed(4)
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
 * STRATEGY: HYBRID CONFLUENCE (OB + FLOW + TREND)
 * The Elite engine. Requires structural and momentum alignment.
 * @param {Object} depth - Order Book depth
 * @param {Array} candles - Price history
 * @param {Object} config - { timeframe, mode: 'SWING' | 'BLITZ' }
 */
export const analyzeHybrid = (depth, candles, config = {}) => {
    // 1. Run OB analysis
    const obResult = analyzeOB(candles);

    // 2. Run Flow analysis
    const flowResult = analyzeFlow(depth, candles);

    const lastPrice = obResult.price;
    const obZone = obResult.obZone;
    const flow = flowResult.indicators.flow;
    const buyPressure = parseFloat(flow.ratio);

    // 3. Confluence Logic
    const isBlitz = config.mode === 'BLITZ';

    // ELITE FILTER: Relax EMA 200 for Blitz (allow mean reversion)
    const isMacroBullish = isBlitz ? true : (lastPrice > (obResult.ema || 0));
    const isBullishOB = obResult.prediction.signal === 'BUY' || obResult.prediction.signal === 'BULLISH';

    // TURBO: Lower flow requirement for Blitz
    const flowThreshold = isBlitz ? 1.2 : 1.5;
    const isBullishFlow = buyPressure >= flowThreshold;

    let signal = 'NEUTRAL';
    let label = 'BUSCANDO CONFLUENCIA';
    let color = '#94A3B8';
    let intensity = 0;

    if (isBullishOB && isBullishFlow && isMacroBullish) {
        signal = 'STRONG_BUY';
        label = `🎯 HYBRID ${isBlitz ? 'BLITZ' : 'CONFLUENCE'} (${flow.bidPercent}%)`;
        color = isBlitz ? '#F59E0B' : '#00D9FF';
        intensity = 100;
    } else if (isBullishOB && isMacroBullish) {
        label = 'OB ZONA (ESPERANDO FLOW)';
        color = '#10B981';
        intensity = 40;
    } else if (isBullishFlow) {
        label = 'FLOW ALCISTA (SIN ZONA)';
        color = '#34D399';
        intensity = 40;
    }

    return {
        price: lastPrice,
        obZone: obZone,
        wallPrice: flowResult.wallPrice,
        indicators: {
            ...flowResult.indicators,
            ...obResult.indicators,
            mode: config.mode || 'SWING'
        },
        chartData: obResult.chartData,
        prediction: {
            signal,
            label,
            color,
            intensity
        }
    };
};

/**
 * PHASE 5: AI REGIME DETECTION
 * Identifies if the market is Trending or Ranging using ADX.
 * @param {Array} candles - Price history
 */
export const detectRegime = (candles) => {
    if (!candles || candles.length < 30) return { regime: 'UNKNOWN', adx: 0 };

    const highs = candles.map(c => c.high || parseFloat(c[2]));
    const lows = candles.map(c => c.low || parseFloat(c[3]));
    const closes = candles.map(c => c.close || parseFloat(c[4]));

    const adxValues = ADX.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14
    });

    const currentADX = adxValues.length > 0 ? adxValues[adxValues.length - 1].adx : 0;

    // ADX Logic: > 25 = Strong Trend, < 20 = Ranging/Weak Trend
    let regime = 'RANGING';
    let label = 'LATERAL / RANGO ⚖️';
    if (currentADX > 25) {
        regime = 'TRENDING';
        label = 'TENDENCIAL 📈';
    } else if (currentADX > 20) {
        label = 'INICIO TENDENCIA ↗️';
    }

    return {
        regime,
        adx: currentADX,
        label,
        color: regime === 'TRENDING' ? '#00D9FF' : '#94A3B8'
    };
};

/**
 * PHASE 5: AI KELLY CRITERION (Dynamic Risk)
 * Suggests a risk multiplier based on recent win rate from history.
 * @param {Array} history - Trading history
 */
export const calculateKelly = (history) => {
    if (!history || history.length < 5) return 1.0; // Default multiplier

    const recent = history.slice(-10); // Look at last 10 trades
    const wins = recent.filter(t => t.pnl > 0).length;
    const winRate = wins / recent.length;

    // Simplified Kelly: Risk more when win rate is high, less when low.
    // We cap the multiplier between 0.5x and 1.5x for safety.
    let multiplier = 1.0;
    if (winRate > 0.6) multiplier = 1.3; // Hot streak
    if (winRate > 0.8) multiplier = 1.5; // Burning
    if (winRate < 0.4) multiplier = 0.7; // Cold streak
    if (winRate < 0.2) multiplier = 0.5; // Defensive

    return multiplier;
};
