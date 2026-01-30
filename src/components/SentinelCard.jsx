import React from 'react';
import { TrendingUp, TrendingDown, Activity, Minus } from 'lucide-react';
import { motion } from 'framer-motion';
import styles from './SentinelCard.module.css';

const SentinelCard = ({ symbol, data, loading, onSimulate }) => {
    if (loading || !data) {
        return <div className={`${styles.card} ${styles.loading}`}>Loading...</div>;
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
        boxShadow: `0 0 ${intensity / 2}px ${color}`,
        '--card-accent': color
    };

    const getIcon = () => {
        if (signal.includes('BUY')) return <TrendingUp size={24} />;
        if (signal.includes('SELL')) return <TrendingDown size={24} />;
        return <Minus size={24} />;
    };

    const isSniper = signal.includes('STRONG');

    return (
        <motion.div
            className={`${styles.card} ${isSniper ? styles.sniperPulse : ''}`}
            style={glowStyle}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.02, boxShadow: `0 0 30px ${color}` }}
            transition={{ duration: 0.3 }}
        >
            <div className={styles.header}>
                <div className={styles.symbolWrapper}>
                    <span className={styles.symbol}>{symbol.replace('USDT', '')}</span>
                    <span className={styles.pair}>/USDT</span>
                </div>
                <div className={styles.price}>${price.toLocaleString()}</div>
            </div>

            <div className={styles.mainSignal} style={{ color: color }}>
                {getIcon()}
                <span className={styles.signalText}>{label}</span>
            </div>

            {/* Bollinger Radar */}
            <div className={styles.radarContainer}>
                <div className={styles.radarLabels}>
                    <span className={styles.radarZone}>BUY ZONE</span>
                    <span className={styles.radarZone}>SELL ZONE</span>
                </div>
                <div className={styles.radarBar}>
                    <div className={styles.radarTrack}></div>
                    <motion.div
                        className={styles.radarDot}
                        initial={false}
                        animate={{
                            left: `${Math.min(100, Math.max(0, ((price - parseFloat(indicators.bb.lower)) / (parseFloat(indicators.bb.upper) - parseFloat(indicators.bb.lower))) * 100))}%`
                        }}
                    />
                </div>
            </div>

            {/* Detail Overlay */}
            <div className={styles.details}>
                <div className={styles.metric}>
                    <span className={styles.metricLabel}>RSI (14)</span>
                    <span className={styles.metricValue} style={{
                        color: indicators.rsi > 70 ? '#ff0055' : indicators.rsi < 30 ? '#00ffaa' : '#EAECEF'
                    }}>
                        {indicators.rsi}
                    </span>
                </div>
                <div className={styles.metric}>
                    <span className={styles.metricLabel}>BB Range</span>
                    <span className={styles.metricValue} style={{ fontSize: '0.65rem' }}>
                        ${indicators.bb.lower} - ${indicators.bb.upper}
                    </span>
                </div>
            </div>

            <div className={styles.footer}>
                <button
                    className={`${styles.simulateBtn} ${styles.buyBtn}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onSimulate(symbol, price, 'LONG');
                    }}
                >
                    <TrendingUp size={14} /> COMPRA
                </button>

            </div>

            {/* Ambient Background Glow */}
            <div className={styles.bgGlow} style={{ background: color }} />

            {/* Sparkline Chart */}
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '60px', overflow: 'hidden', opacity: 0.5, zIndex: 0 }}>
                <MiniChart data={data.history || []} color={color} />
            </div>

        </motion.div>
    );
};

// Mini Sparkline Component
const MiniChart = ({ data, color }) => {
    if (!data || data.length < 2) return null;

    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1; // Avoid division by zero

    // Normalize to 0-100 height, width stretched to 100%
    const points = data.map((price, index) => {
        const x = (index / (data.length - 1)) * 100;
        const y = 100 - ((price - min) / range) * 100; // Invert Y because SVG 0 is top
        return `${x},${y}`;
    }).join(' ');

    return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
            <polyline
                fill="none"
                stroke={color === '#94A3B8' ? '#4B5563' : color} // Darker gray for neutral
                strokeWidth="2"
                points={points}
                vectorEffect="non-scaling-stroke"
            />
            {/* Gradient Fill under line */}
            <path
                d={`M0,100 L0,${100 - ((data[0] - min) / range) * 100} ${points.replace(/,/g, ' ').split(' ').map((coord, i) => (i % 2 === 0 ? `L${coord}` : coord)).join(' ')} L100,100 Z`}
                fill={color}
                fillOpacity="0.1"
            />
        </svg>
    );
};

export default SentinelCard;
