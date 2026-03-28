
import React from 'react';
import styles from './SentinelCard.module.css';
import { motion } from 'framer-motion';
import NumberTicker from './NumberTicker';

const SentinelCard = ({ symbol, data, loading, onSimulate, minOdds, showVolcano = true, readOnly }) => {
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

    // --- SMART DIP DECISION LOGIC ---
    let finalDecision = false;
    if (showVolcano !== false) {
        finalDecision = signal === 'STRONG_BUY';
    }

    // DETERMINE SIGNAL LABEL & COLOR
    let label = 'ESCANNEANDO';
    let subLabel = 'BUSCANDO OPORTUNIDAD';
    let color = '#64748B'; // Neutral Slate
    let statusBg = 'rgba(100, 116, 139, 0.1)';
    let isSignal = false;

    // PRIORITY: SIGNAL DETECTED
    if (finalDecision) {
        label = 'DIP EXTREMO DETECTADO';
        subLabel = `DIP: ${indicators.dipPercent}%`;
        color = '#10B981'; // Green instead of Red
        statusBg = 'rgba(16, 185, 129, 0.2)';
        isSignal = true;
    } else if (prediction.label?.includes('OBSER') || prediction.label?.includes('DIP')) {
        label = 'OBSERVANDO (MERCADO)';
        subLabel = `DIP: ${indicators.dipPercent || '---'}%`;
        color = '#F59E0B';
        statusBg = 'rgba(245, 158, 11, 0.1)';
    }

    // --- MOTOR DE IDENTIDAD VISUAL ---
    const coinThemes = {
        'BTC': { icon: '₿', color: '#F7931A' },
        'ETH': { icon: '💠', color: '#627EEA' },
        'BNB': { icon: '🔶', color: '#F3BA2F' },
        'SOL': { icon: '☀️', color: '#14F195' },
        'DOGE': { icon: '🐶', color: '#E1B31E' },
        'XRP': { icon: '✕', color: '#23292F' },
        'ADA': { icon: '₳', color: '#0033AD' },
        'AVAX': { icon: '🔺', color: '#E84142' },
        'DOT': { icon: '⚪', color: '#E6007A' },
        'LINK': { icon: '🔗', color: '#2A5ADA' }
    };

    const cleanSymbol = symbol.replace('USDT', '');
    const theme = coinThemes[cleanSymbol] || { icon: cleanSymbol.substring(0, 1), color: '#334155' };

    return (
        <motion.div
            className={`${styles.card} ${isSignal ? styles.flash : ''}`}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            style={{
                borderLeft: isSignal ? `4px solid ${color}` : '1px solid rgba(255,255,255,0.05)',
            }}
        >
            {/* COLUMN 1: SYMBOL */}
            <div className={styles.header}>
                <div style={{
                    width: '38px', height: '38px', borderRadius: '12px',
                    background: 'rgba(15, 15, 25, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 'bold', fontSize: '18px', color: '#fff',
                    boxShadow: `0 0 15px ${theme.color}22`,
                    border: `1px solid ${theme.color}33`
                }}>
                    {theme.icon}
                </div>
                <div>
                    <div className={styles.symbol}>{cleanSymbol}</div>
                    <div className={styles.subSymbol}>SMART DIP</div>
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
            </div>

            {/* COLUMN 3: STATUS INDICATORS */}
            <div className={styles.statusSection} style={{ flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                <div style={{
                    fontSize: '0.7rem', fontWeight: 'bold',
                    color: indicators.dipPercent <= -3.0 ? '#10B981' : '#64748B',
                    display: 'flex', alignItems: 'center', gap: '4px'
                }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: indicators.dipPercent <= -3.0 ? '#10B981' : '#334155' }}></div>
                    DIP: {indicators.dipPercent}%
                </div>

                <div style={{
                    fontSize: '0.7rem', fontWeight: 'bold',
                    color: indicators.rsi < 35 ? '#10B981' : '#64748B',
                    display: 'flex', alignItems: 'center', gap: '4px'
                }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: indicators.rsi < 35 ? '#10B981' : '#334155' }}></div>
                    RSI: {indicators.rsi}
                </div>
            </div>

            {/* COLUMN 4: ACTION */}
            <div className={styles.actionSection}>
                {isSignal ? (
                    <motion.button
                        whileTap={!readOnly ? { scale: 0.95 } : {}}
                        onClick={() => !readOnly && onSimulate(symbol, price)}
                        style={{
                            background: readOnly ? 'rgba(51, 65, 85, 0.4)' : 'rgba(16, 185, 129, 0.15)',
                            color: readOnly ? '#64748B' : '#10B981',
                            border: readOnly ? '1px solid rgba(255,255,255,0.05)' : '1px solid #10B981',
                            padding: '10px 20px', borderRadius: '12px',
                            cursor: readOnly ? 'default' : 'pointer',
                            fontWeight: 'bold',
                            fontSize: '0.75rem', width: '100%', maxWidth: '140px'
                        }}
                    >
                        {readOnly ? '👁️ VISOR' : '🔥 BUY DIP'}
                    </motion.button>
                ) : (
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.65rem', color: color, fontWeight: 'bold' }}>{label}</div>
                        <div style={{ fontSize: '0.55rem', color: '#64748B' }}>{subLabel}</div>
                    </div>
                )}
            </div>

        </motion.div >
    );
};

export default React.memo(SentinelCard);
