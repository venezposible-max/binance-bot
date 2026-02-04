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

            {/* COLUMN 3: STATUS */}
            <div className={styles.statusSection}>
                <div style={{
                    background: statusBg, color: color, padding: '6px 14px', borderRadius: '4px',
                    fontSize: '0.75rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px',
                    border: `1px solid ${color}30`,
                    animation: pulse ? `${styles.pulse} 2s infinite` : 'none',
                    minWidth: '140px', justifyContent: 'center'
                }}>
                    {pulse && <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }}></span>}
                    {label}
                </div>
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
                        <div style={{ fontSize: '0.7rem', color: '#64748B' }}>RSI: <span style={{ color: '#E2E8F0' }}>{indicators.rsi ? parseFloat(indicators.rsi).toFixed(1) : '--'}</span></div>
                        <div style={{ fontSize: '0.7rem', color: '#64748B' }}>INT: <span style={{ color: '#E2E8F0' }}>{intensity || 0}%</span></div>
                    </div>
                )}
            </div>

        </motion.div>
    );
};

export default React.memo(SentinelCard);
