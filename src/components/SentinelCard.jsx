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
    let label = 'ESCANEANDO...';
    let color = '#475569'; // Neutral Slate
    let glow = 'none';
    let isSignal = false;
    let bgGradient = 'linear-gradient(180deg, #0F172A 0%, #0F172A 100%)';

    // PRIORITY: SIGNAL DETECTED
    if (signal?.includes('BUY')) {
        label = '🚀 SEÑAL PARA OPERAR';
        color = '#10B981';
        glow = '0 0 25px rgba(16, 185, 129, 0.5)';
        isSignal = true;
        bgGradient = 'linear-gradient(180deg, rgba(16, 185, 129, 0.1) 0%, #0F172A 100%)';
    } else if (signal?.includes('SELL')) {
        label = '🔻 SEÑAL PARA OPERAR';
        color = '#EF4444';
        glow = '0 0 25px rgba(239, 68, 68, 0.5)';
        isSignal = true;
        bgGradient = 'linear-gradient(180deg, rgba(239, 68, 68, 0.1) 0%, #0F172A 100%)';
    }

    // Check if data is just default/placeholder
    const isDefault = (!indicators.rsi || indicators.rsi === 50) && (!indicators.ema || indicators.ema === 0);

    return (
        <motion.div
            className={styles.card}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            style={{
                borderTop: `4px solid ${color}`,
                boxShadow: glow,
                background: bgGradient
            }}
        >
            <div className={styles.header}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span className={styles.symbol}>{symbol.replace('USDT', '')}</span>
                    <span className={styles.subSymbol}>PERPETUAL</span>
                </div>
                <div className={styles.priceValue} style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 'bold' }}>
                    <NumberTicker
                        value={parseFloat(price)}
                        decimals={parseFloat(price) < 0.0001 ? 8 : parseFloat(price) < 1 ? 6 : 2}
                        prefix="$"
                    />
                </div>
            </div>

            {/* Only show indicators if they are VALID (non-default) OR if we have a signal */}
            {!isDefault && (
                <div className={styles.indicatorsGrid} style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '15px'
                }}>
                    <div className={styles.indicator} style={{ background: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: '4px' }}>
                        <span className={styles.indLabel} style={{ fontSize: '0.7rem', color: '#94A3B8' }}>RSI (14)</span>
                        <div className={styles.indValue} style={{ fontSize: '1.1rem', fontWeight: 'bold', color: parseFloat(indicators.rsi) < 30 ? '#10B981' : parseFloat(indicators.rsi) > 70 ? '#EF4444' : '#E2E8F0' }}>
                            {parseFloat(indicators.rsi).toFixed(1)}
                        </div>
                    </div>
                    <div className={styles.indicator} style={{ background: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: '4px' }}>
                        <span className={styles.indLabel} style={{ fontSize: '0.7rem', color: '#94A3B8' }}>EMA (200)</span>
                        <div className={styles.indValue} style={{ fontSize: '1rem', fontWeight: 'bold', color: '#F59E0B' }}>
                            ${parseFloat(indicators.ema).toFixed(price < 1 ? 4 : 2)}
                        </div>
                    </div>
                </div>
            )}

            <div className={styles.signalBadge} style={{
                background: isSignal ? color : 'rgba(255,255,255,0.03)',
                color: isSignal ? '#000' : '#64748B',
                boxShadow: isSignal ? `0 0 15px ${color}` : 'none',
                textAlign: 'center', padding: '10px', borderRadius: '6px', marginTop: '15px',
                fontWeight: 'bold', fontSize: isSignal ? '1rem' : '0.8rem',
                border: isSignal ? 'none' : '1px dashed #334155',
                textTransform: 'uppercase',
                letterSpacing: '1px'
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
