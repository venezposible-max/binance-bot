import React from 'react';
import styles from './SentinelCard.module.css';
import { motion } from 'framer-motion';
import NumberTicker from './NumberTicker';

const SentinelCard = ({ symbol, data, loading, onSimulate }) => {
    // Phase 1: Skeleton Loading (Row)
    if (loading || !data) {
        return (
            <div className={styles.card} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className={styles.loadingPulse}>⌛</span>
            </div>
        );
    }

    const {
        price = 0,
        indicators = {},
        prediction = {}
    } = data || {};

    const signal = prediction.signal || data?.signal || 'WAIT';
    const intensity = prediction.intensity || data?.intensity || 0;


    // DETERMINE SIGNAL LABEL & COLOR
    let label = 'ESCANNEANDO';
    let subLabel = 'BUSCANDO ENTRADA';
    let color = '#64748B'; // Neutral Slate
    let statusBg = 'rgba(100, 116, 139, 0.1)';
    let isSignal = false;
    let pulse = true;

    // PRIORITY: SIGNAL DETECTED
    if (signal?.includes('BUY')) {
        label = 'LONG DETECTADO';
        subLabel = `INTENSIDAD: ${intensity}%`;
        color = '#10B981';
        statusBg = 'rgba(16, 185, 129, 0.2)';
        isSignal = true;
        pulse = false;
    } else if (signal?.includes('SELL')) {
        label = 'SHORT DETECTADO';
        subLabel = `INTENSIDAD: ${intensity}%`;
        color = '#EF4444';
        statusBg = 'rgba(239, 68, 68, 0.2)';
        isSignal = true;
        pulse = false;
    }

    return (
        <motion.div
            className={styles.card}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            style={{
                borderLeft: isSignal ? `4px solid ${color}` : '1px solid rgba(255,255,255,0.05)',
            }}
        >
            {/* COLUMN 1: SYMBOL */}
            <div className={styles.header}>
                <div style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    background: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 'bold', fontSize: '12px', color: '#fff'
                }}>
                    {symbol.substring(0, 1)}
                </div>
                <div>
                    <div className={styles.symbol}>{symbol.replace('USDT', '')}</div>
                    <div className={styles.subSymbol}>PERPETUAL</div>
                </div>
            </div>

            {/* COLUMN 2: PRICE */}
            <div className={styles.priceSection}>
                <div className={styles.priceValue} style={{ color: isSignal ? color : '#fff' }}>
                    <NumberTicker
                        value={parseFloat(price)}
                        decimals={parseFloat(price) < 1 ? 5 : 2}
                        prefix="$"
                    />
                </div>
                {/* Optional: Add 24h change here if available later */}
            </div>

            {/* COLUMN 3: TRAFFIC LIGHT STATUS */}
            <div className={styles.statusSection} style={{ flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                {/* 1. DIP INDICATOR */}
                <div style={{
                    fontSize: '0.7rem', fontWeight: 'bold',
                    color: indicators.isDip ? '#10B981' : '#64748B',
                    display: 'flex', alignItems: 'center', gap: '4px'
                }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: indicators.isDip ? '#10B981' : '#334155', boxShadow: indicators.isDip ? '0 0 5px #10B981' : 'none' }}></div>
                    {indicators.isDip ? '📉 DIP: SI' : '➖ DIP: NO'}
                </div>

                {/* 2. PROB INDICATOR */}
                {indicators.hybrid?.odds && (
                    <div style={{
                        fontSize: '0.7rem', fontWeight: 'bold',
                        color: parseFloat(indicators.hybrid.odds) >= 60 ? '#10B981' : '#EF4444',
                        display: 'flex', alignItems: 'center', gap: '4px'
                    }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: parseFloat(indicators.hybrid.odds) >= 60 ? '#10B981' : '#EF4444', boxShadow: parseFloat(indicators.hybrid.odds) >= 60 ? '0 0 5px #10B981' : 'none' }}></div>
                        🧬 PROB: {parseFloat(indicators.hybrid.odds).toFixed(0)}%
                    </div>
                )}
            </div>

            {/* COLUMN 4: ACTION / INFO */}
            <div className={styles.actionSection}>
                {isSignal ? (
                    <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => onSimulate(symbol, price)}
                        style={{
                            background: color, color: '#000', border: 'none',
                            padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold',
                            fontSize: '0.8rem', width: '100%', maxWidth: '140px'
                        }}
                    >
                        ⚡ ENTRAR
                    </motion.button>
                ) : (
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.7rem', color: '#64748B' }}>
                            RSI: <span style={{ color: '#E2E8F0' }}>{indicators.rsi ? parseFloat(indicators.rsi).toFixed(1) : '--'}</span>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#64748B' }}>
                            INT: <span style={{ color: '#E2E8F0' }}>{intensity || 0}%</span>
                        </div>
                    </div>
                )}
            </div>

        </motion.div >
    );
};

export default React.memo(SentinelCard);
