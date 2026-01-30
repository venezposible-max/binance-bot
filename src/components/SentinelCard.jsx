import React, { useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Activity, Minus } from 'lucide-react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import ProfessionalChart from './ProfessionalChart';
import styles from './SentinelCard.module.css';

// Animated Number Component
const NumberTicker = ({ value, decimals = 2, prefix = '', suffix = '', style }) => {
    const ref = useRef(null);
    const motionValue = useMotionValue(value);
    const springValue = useSpring(motionValue, { stiffness: 50, damping: 15 }); // Soft spring

    useEffect(() => {
        motionValue.set(value);
    }, [value]);

    useEffect(() => {
        const unsubscribe = springValue.on("change", (latest) => {
            if (ref.current) {
                ref.current.textContent = prefix + latest.toFixed(decimals) + suffix;
            }
        });
        return () => unsubscribe();
    }, [springValue, decimals, prefix, suffix]);

    return <span ref={ref} style={style}>{prefix + value.toFixed(decimals) + suffix}</span>;
};

const SentinelCard = ({ symbol, data, loading, onSimulate }) => {
    if (loading || !data) {
        return (
            <motion.div
                className={`${styles.card} ${styles.loading}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
            >
                Loading...
            </motion.div>
        );
    }

    const { price, prediction, indicators } = data;

    // Override SELL to NEUTRAL for Long-Only visual clarity
    let { signal, label, color, intensity } = prediction;
    if (signal.includes('SELL')) {
        signal = 'NEUTRAL';
        label = 'NEUTRAL (WAIT)';
        color = '#94A3B8'; // Slate Gray
        intensity = 1; // Low intensity
    }

    // Dynamic Neon Style
    const glowStyle = {
        borderColor: color,
        boxShadow: `0 0 ${intensity / 3}px ${color}40`, // softer glow
        '--card-accent': color
    };

    const getIcon = () => {
        if (signal.includes('BUY')) return <TrendingUp size={24} />;
        if (signal.includes('SELL')) return <TrendingDown size={24} />;
        return <Minus size={24} />;
    };

    const isSniper = signal.includes('STRONG');

    // Advanced Animation Variants
    const cardVariants = {
        hidden: { opacity: 0, scale: 0.9, y: 20 },
        visible: {
            opacity: 1,
            scale: 1,
            y: 0,
            transition: { type: "spring", stiffness: 260, damping: 20 }
        },
        hover: {
            scale: 1.03,
            boxShadow: `0 0 40px ${color}60`,
            zIndex: 10
        }
    };

    return (
        <motion.div
            className={`${styles.card} ${isSniper ? styles.sniperPulse : ''}`}
            style={glowStyle}
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            whileHover="hover"
            layoutId={symbol} // Shared Layout Animation
        >
            <div className={styles.header}>
                <div className={styles.symbolWrapper}>
                    <span className={styles.symbol}>{symbol.replace('USDT', '')}</span>
                    <span className={styles.pair}>/USDT</span>
                </div>
                <div className={styles.iconWrapper} style={{ color }}>
                    {getIcon()}
                </div>
            </div>

            <div className={styles.priceSection}>
                <div className={styles.priceLabel}>PRECIO ACTUAL</div>
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
                <div className={styles.indicator}>
                    <span className={styles.indLabel} style={{ fontSize: '0.7rem', color: '#888' }}>RSI (14)</span>
                    <div className={styles.indValue} style={{
                        fontSize: '1.1rem', fontWeight: 'bold',
                        color: parseFloat(indicators.rsi) < 30 ? '#10B981' : parseFloat(indicators.rsi) > 70 ? '#EF4444' : '#94A3B8'
                    }}>
                        <NumberTicker value={parseFloat(indicators.rsi)} decimals={1} />
                    </div>
                </div>
                <div className={styles.indicator}>
                    <span className={styles.indLabel} style={{ fontSize: '0.7rem', color: '#888' }}>EMA (200)</span>
                    <div className={styles.indValue} style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#F59E0B' }}>
                        {indicators.ema !== '---' && !isNaN(indicators.ema) ?
                            <NumberTicker value={parseFloat(indicators.ema)} decimals={price < 1 ? 4 : 2} prefix="$" />
                            : 'LOADING...'}
                    </div>
                </div>
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
                    onClick={() => onSimulate(symbol.replace('USDT', ''), price)}
                    style={{
                        background: 'rgba(16, 185, 129, 0.2)', color: '#10B981', border: '1px solid #10B981',
                        width: '100%', padding: '10px', marginTop: '10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
                    }}
                >
                    🚀 EJECUTAR LONG
                </motion.button>
            )}

            {/* Professional Chart with Recharts */}
            {data.candles && data.candles.length > 0 && (
                <ProfessionalChart
                    candles={data.candles}
                    emaData={data.chartData?.ema || []}
                    color={color}
                />
            )}

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

export default SentinelCard;
