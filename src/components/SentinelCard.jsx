
import React from 'react';
import styles from './SentinelCard.module.css';
import { motion } from 'framer-motion';
import NumberTicker from './NumberTicker';

const SentinelCard = ({ symbol, data, loading, onSimulate, minOdds, showDip = true, showProb = true, showUnixa = false, readOnly }) => {
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


    // --- MODULAR DECISION LOGIC (Visual Sync with Backend) ---
    const vortexSignal = signal?.includes('BUY');
    const hybridSignal = parseFloat(indicators.hybrid?.odds || 0) >= (minOdds || 67);

    let finalDecision = false;

    // 1. Vortex Check
    let passVortex = true;
    if (showDip !== false) { // If Vortex Module ON
        passVortex = vortexSignal;
    }

    // 2. Hybrid Check
    let passHybrid = true;
    if (showProb !== false) { // If Hybrid Module ON
        passHybrid = hybridSignal;
    }

    // 3. Safety: If both modules OFF, no decision.
    if (showDip === false && showProb === false) {
        finalDecision = false;
    } else {
        finalDecision = passVortex && passHybrid;
    }

    // DETERMINE SIGNAL LABEL & COLOR
    let label = 'ESCANNEANDO';
    let subLabel = 'BUSCANDO ENTRADA';
    let color = '#64748B'; // Neutral Slate
    let statusBg = 'rgba(100, 116, 139, 0.1)';
    let isSignal = false;
    let pulse = true;

    // PRIORITY: SIGNAL DETECTED
    if (finalDecision) {
        label = 'LONG DETECTADO';
        subLabel = `INTENSIDAD: ${intensity}%`;
        color = '#10B981';
        statusBg = 'rgba(16, 185, 129, 0.2)';
        isSignal = true;
        pulse = false;
    } else if (signal?.includes('SELL')) {
        // Keeps SELL logic just for visualization if needed, though strategy is LONG-only usually
        label = 'SHORT DETECTADO';
        subLabel = `INTENSIDAD: ${intensity}%`;
        color = '#EF4444';
        statusBg = 'rgba(239, 68, 68, 0.2)';
        isSignal = true;
        pulse = false;
    }

    // --- MOTOR DE IDENTIDAD VISUAL ---
    const coinThemes = {
        'BTC': { icon: '₿', color: '#F7931A' },
        'ETH': { icon: '💠', color: '#627EEA' },
        'BNB': { icon: '🔶', color: '#F3BA2F' },
        'SOL': { icon: '☀️', color: '#14F195' },
        'DOGE': { icon: '🐶', color: '#E1B31E' },
        'ORCA': { icon: '🐋', color: '#00D9FF' },
        'MATIC': { icon: 'Ⓜ️', color: '#8247E5' },
        'XRP': { icon: '✕', color: '#23292F' },
        'ADA': { icon: '₳', color: '#0033AD' },
        'NEAR': { icon: 'Ⓝ', color: '#000000' },
        'PEPE': { icon: '🐸', color: '#00FF00' },
        'SHIB': { icon: '🐕', color: '#FFA500' },
        'AVAX': { icon: '🔺', color: '#E84142' },
        'DOT': { icon: '⚪', color: '#E6007A' },
        'LINK': { icon: '🔗', color: '#2A5ADA' },
        'TRX': { icon: '💎', color: '#EF0011' },
        'LTC': { icon: 'Ł', color: '#BEBEBE' },
        'WIF': { icon: '🎩', color: '#A52A2A' },
        'ARB': { icon: '🔵', color: '#28A0F0' },
        'OP': { icon: '🔴', color: '#FF0420' }
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
                    <div className={styles.subSymbol}>SPOT ALPHA</div>
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
                {/* 1. VORTEX / UNIXA INDICATOR */}
                {(showDip !== false || showUnixa) && (() => {
                    const isUnixa = showUnixa === true;
                    const rsiThreshold = isUnixa ? 2.0 : 5.0;
                    const rsiValue = parseFloat(indicators.rsi2);
                    const isTriggered = rsiValue < rsiThreshold;
                    const labelName = isUnixa ? 'UNIXA' : 'VORTEX';
                    const hitColor = isUnixa ? '#F59E0B' : '#10B981';
                    const icon = isUnixa ? '🪐' : '🌪️';

                    return (
                        <div style={{
                            fontSize: '0.7rem', fontWeight: 'bold',
                            color: isTriggered ? hitColor : '#64748B',
                            display: 'flex', alignItems: 'center', gap: '4px'
                        }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: isTriggered ? hitColor : '#334155', boxShadow: isTriggered ? `0 0 5px ${hitColor}` : 'none' }}></div>
                            {isTriggered ? `${icon} ${labelName}: SI` : `➖ ${labelName}: NO`}
                        </div>
                    );
                })()}

                {/* 2. PROB INDICATOR */}
                {showProb !== false && indicators.hybrid?.odds && (
                    <div style={{
                        fontSize: '0.7rem', fontWeight: 'bold',
                        color: parseFloat(indicators.hybrid.odds) >= (minOdds || 67) ? '#10B981' : '#EF4444',
                        display: 'flex', alignItems: 'center', gap: '4px'
                    }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: parseFloat(indicators.hybrid.odds) >= (minOdds || 67) ? '#10B981' : '#EF4444', boxShadow: parseFloat(indicators.hybrid.odds) >= (minOdds || 67) ? '0 0 5px #10B981' : 'none' }}></div>
                        🧬 PROB: {parseFloat(indicators.hybrid.odds).toFixed(0)}%
                    </div>
                )}
            </div>

            {/* COLUMN 4: ACTION / INFO */}
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
                            fontSize: '0.75rem', width: '100%', maxWidth: '140px',
                            boxShadow: readOnly ? 'none' : '0 0 15px rgba(16, 185, 129, 0.2)',
                            textTransform: 'uppercase',
                            letterSpacing: '1px'
                        }}
                    >
                        {readOnly ? '👁️ VISOR' : '⚡ ENTRAR'}
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
