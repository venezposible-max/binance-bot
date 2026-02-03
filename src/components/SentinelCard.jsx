import React from 'react';
import styles from './SentinelCard.module.css';
import { motion } from 'framer-motion';
import NumberTicker from './NumberTicker';

import ProfessionalChart from './ProfessionalChart';

const SentinelCard = ({ symbol, data, loading, onSimulate, walletConfig, currentPrice }) => {
    // Phase 1: Skeleton Loading
    if (loading || !data) {
        return (
            <div className={styles.card} style={{ height: '350px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className={styles.loadingPulse}>⌛ Cargando Radar...</span>
            </div>
        );
    }

    const {
        price = 0,
        forecast = {},
        indicators = { rsi: 50, ema: 0 },
        signal = 'WAIT',
        score = 0,
        obZone = {},
        triple = {},
        flow = {},
        hybrid = {},
        candles = [],
        chartData = {},
        wallPrice = 0
    } = data || {};


    // DETERMINE SIGNAL LABEL & COLOR
    let label = 'ESPERANDO';
    let color = '#94A3B8'; // Neutral Grey
    let glow = 'none';

    // PRIORITY 1: HYBRID SIGNAL (The new brain)
    if (signal === 'BUY_SIGNAL_HYBRID' || signal === 'BUY') { // Fallback to standard buy
        label = '🟢 BUY DETECTED';
        color = '#10B981';
        glow = '0 0 20px rgba(16, 185, 129, 0.4)';
    } else if (signal === 'SELL_SIGNAL_HYBRID' || signal === 'SELL') {
        label = '🔴 SELL DETECTED';
        color = '#EF4444';
        glow = '0 0 20px rgba(239, 68, 68, 0.4)';
    } else if (signal === 'WAIT') {
        label = 'ESPERANDO...';
        color = '#94A3B8';
    }


    return (
        <motion.div
            className={styles.card}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            style={{ borderTop: `4px solid ${color}`, boxShadow: glow }}
        >
            <div className={styles.header}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span className={styles.symbol}>{symbol.replace('USDT', '')}</span>
                    <span className={styles.subSymbol}>PERPETUAL</span>
                </div>
                {/* Real-Time Price with Ticker Animation */}
                <div className={styles.priceValue} style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 'bold' }}>
                    <NumberTicker value={parseFloat(price)} decimals={price < 1 ? 4 : 2} prefix="$" />
                </div>
            </div>


            <div className={styles.indicatorsGrid} style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
                marginTop: '10px',
                position: 'relative',
                zIndex: 2
            }}>
                {(indicators.flow || indicators.mode) ? (
                    /* FLOW / HYBRID STRATEGY VISUALIZATION */
                    <>
                        <div className={styles.indicator}>
                            <span className={styles.indLabel} style={{ fontSize: '0.7rem', color: '#888' }}>BID PRESSURE</span>
                            <div className={styles.indValue} style={{
                                fontSize: '1.1rem', fontWeight: 'bold',
                                color: parseFloat(indicators.flow?.ratio || 1) > 1.5 ? '#10B981' : parseFloat(indicators.flow?.ratio || 1) < 0.7 ? '#EF4444' : '#94A3B8',
                                transition: 'color 0.5s ease'
                            }}>
                                <NumberTicker value={parseFloat(indicators.flow?.ratio || 0)} decimals={2} suffix="x" />
                            </div>
                        </div>
                        <div className={styles.indicator}>
                            <span className={styles.indLabel} style={{ fontSize: '0.7rem', color: '#888' }}>RSI (CONFLUENCE)</span>
                            <div className={styles.indValue} style={{
                                fontSize: '1.1rem',
                                fontWeight: 'bold',
                                color: parseFloat(indicators.rsi) < 30 ? '#10B981' : parseFloat(indicators.rsi) > 70 ? '#EF4444' : '#F59E0B'
                            }}>
                                <NumberTicker value={parseFloat(indicators.rsi)} decimals={1} />
                            </div>
                        </div>
                    </>
                ) : (
                    /* STANDARD TECHNICALS */
                    <>
                        <div className={styles.indicator}>
                            <span className={styles.indLabel} style={{ fontSize: '0.7rem', color: '#888' }}>
                                {indicators.rsi1h ? 'RSI (4h|1h|15m)' : 'RSI (14)'}
                            </span>
                            <div className={styles.indValue} style={{
                                fontSize: indicators.rsi1h ? '0.9rem' : '1.1rem',
                                fontWeight: 'bold',
                                color: parseFloat(indicators.rsi) < 30 ? '#10B981' : parseFloat(indicators.rsi) > 70 ? '#EF4444' : '#94A3B8',
                                display: 'flex',
                                gap: '4px'
                            }}>
                                <NumberTicker value={parseFloat(indicators.rsi)} decimals={1} />
                                {indicators.rsi1h && (
                                    <>
                                        <span style={{ opacity: 0.3 }}>|</span>
                                        <NumberTicker value={parseFloat(indicators.rsi1h)} decimals={1} style={{ color: parseFloat(indicators.rsi1h) < 30 ? '#10B981' : '#888' }} />
                                        <span style={{ opacity: 0.3 }}>|</span>
                                        <NumberTicker value={parseFloat(indicators.rsi15m)} decimals={1} style={{ color: parseFloat(indicators.rsi15m) < 30 ? '#10B981' : '#888' }} />
                                    </>
                                )}
                            </div>
                        </div>
                        <div className={styles.indicator}>
                            <span className={styles.indLabel} style={{ fontSize: '0.7rem', color: '#888' }}>EMA (200)</span>
                            <div className={styles.indValue} style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#F59E0B' }}>
                                {indicators.ema !== '---' && !isNaN(indicators.ema) ?
                                    <NumberTicker value={parseFloat(indicators.ema)} decimals={price < 1 ? 4 : 2} prefix="$" />
                                    : '---'}
                            </div>
                        </div>
                    </>
                )}
            </div>


            <div className={styles.signalBadge} style={{
                background: color, color: '#000', boxShadow: `0 0 15px ${color}`,
                textAlign: 'center', padding: '5px', borderRadius: '4px', marginTop: '15px', fontWeight: 'bold', fontSize: '0.8rem'
            }}>
                {label}
            </div>

            {/* Simulated Trading Button */}
            {signal.includes('BUY') && (
                <motion.button
                    className={styles.actionButton}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => onSimulate(symbol, price)}
                    style={{
                        background: 'rgba(16, 185, 129, 0.2)', color: '#10B981', border: '1px solid #10B981',
                        width: '100%', padding: '10px', marginTop: '10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
                    }}
                >
                    🚀 EJECUTAR LONG
                </motion.button>
            )}

            {/* CHART AREA - Standard Candlesticks */}
            {/* CHART AREA - Standard Candlesticks */}
            <ProfessionalChart
                candles={candles}
                emaData={chartData?.ema || []}
                color={color}
                obZone={obZone}
                wallPrice={wallPrice}
                forecast={forecast}
            />


        </motion.div>
    );
};

// Mini Sparkline Component
const MiniChart = ({ data, ema, color }) => {
    if (!data || data.length < 2) return null;

    // Filter nulls just in case
    const validData = data.filter(n => n !== null && !isNaN(n));
    const validEma = ema ? ema.filter(n => n !== null && !isNaN(n)) : [];

    // Calculate Global Min/Max to fit both lines
    const allPoints = [...validData, ...validEma];
    const max = Math.max(...allPoints);
    const min = Math.min(...allPoints);
    const range = max - min || 1;

    const getPoints = (dataset) => {
        return dataset.map((price, index) => {
            const x = (index / (dataset.length - 1)) * 100;
            const y = 100 - ((price - min) / range) * 100;
            return `${x},${y}`;
        }).join(' ');
    };

    const pricePoints = getPoints(validData);
    const emaPoints = validEma.length > 0 ? getPoints(validEma) : '';

    return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
            {/* EMA Line (Gold/Yellow) */}
            {emaPoints && (
                <polyline
                    fill="none"
                    stroke="#F59E0B" // Amber/Gold Trend Line
                    strokeWidth="1.5"
                    strokeDasharray="4,2" // Dashed line for EMA
                    points={emaPoints}
                    vectorEffect="non-scaling-stroke"
                    opacity="0.8"
                />
            )}

            {/* Price Line */}
            <polyline
                fill="none"
                stroke={color === '#94A3B8' ? '#4B5563' : color}
                strokeWidth="2"
                points={pricePoints}
                vectorEffect="non-scaling-stroke"
            />
            {/* Gradient Fill under Price */}
            <path
                d={`M0,100 L0,${100 - ((validData[0] - min) / range) * 100} ${pricePoints.replace(/,/g, ' ').split(' ').map((coord, i) => (i % 2 === 0 ? `L${coord}` : coord)).join(' ')} L100,100 Z`}
                fill={color}
                fillOpacity="0.1"
            />
        </svg>
    );
};

export default React.memo(SentinelCard);
