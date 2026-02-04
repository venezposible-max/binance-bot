import React from 'react';
import styles from './SentinelCard.module.css';
import { motion } from 'framer-motion';
import NumberTicker from './NumberTicker';

const SentinelCard = ({ symbol, data, loading, onSimulate, walletConfig, currentPrice }) => {
    // Phase 1: Skeleton Loading
    if (loading || !data) {
        return (
            <div className={styles.card} style={{ height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className={styles.loadingPulse}>⌛</span>
            </div>
        );
    }

    const {
        price = 0,
        signal = 'WAIT',
        intensity = 0,
        obZone = {},
        indicators = {}
    } = data || {};


    // DETERMINE SIGNAL LABEL & COLOR
    let label = 'ESCANNEANDO...';
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
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{
                background: 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)',
                border: isSignal ? `1px solid ${color}` : '1px solid rgba(255,255,255,0.05)',
                boxShadow: isSignal ? `0 0 20px ${color}20` : 'none',
                height: 'auto',
                minHeight: '160px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '20px'
            }}
        >
            {/* HEADER: Symbol + Icon */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Coin Icon Placeholder or just Symbol */}
                    <div style={{
                        width: '32px', height: '32px', borderRadius: '50%',
                        background: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 'bold', fontSize: '10px', color: '#fff'
                    }}>
                        {symbol.substring(0, 1)}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#fff', letterSpacing: '0.5px' }}>
                            {symbol.replace('USDT', '')}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: '#94A3B8' }}>USDT PERP</span>
                    </div>
                </div>

                {/* STATUS BADGE */}
                <div style={{
                    background: statusBg, color: color, padding: '4px 10px', borderRadius: '20px',
                    fontSize: '0.7rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px',
                    border: `1px solid ${color}40`, boxShadow: pulse ? `0 0 8px ${color}40` : 'none',
                    animation: pulse ? `${styles.pulse} 2s infinite` : 'none'
                }}>
                    {pulse && <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }}></span>}
                    {label}
                </div>
            </div>

            {/* HERO: PRICE */}
            <div style={{ textAlign: 'center', margin: '15px 0' }}>
                <div style={{
                    fontSize: '2.2rem', fontWeight: 'bold', color: isSignal ? color : '#fff',
                    fontFamily: "'Roboto Mono', monospace", letterSpacing: '-1px'
                }}>
                    <NumberTicker
                        value={parseFloat(price)}
                        decimals={parseFloat(price) < 1 ? 5 : 2}
                        prefix="$"
                    />
                </div>
                {/* 24h Change Placeholder (Simulated aesthetic) */}
                {/* If we had it, it would go here. For now, show sub-label which is status detail */}
                <div style={{ fontSize: '0.8rem', color: isSignal ? color : '#64748B', marginTop: '5px', fontWeight: '500', letterSpacing: '1px' }}>
                    {subLabel}
                </div>
            </div>

            {/* FOOTER: INDICATORS or ACTION */}
            {isSignal ? (
                <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => onSimulate(symbol, price)}
                    style={{
                        background: color, color: '#000', border: 'none',
                        width: '100%', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold',
                        boxShadow: `0 4px 15px ${color}40`
                    }}
                >
                    ⚡ EJECUTAR {signal.includes('BUY') ? 'LONG' : 'SHORT'}
                </motion.button>
            ) : (
                <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px',
                    background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px'
                }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: '#64748B', marginBottom: '2px' }}>RSI</div>
                        <div style={{ fontSize: '0.9rem', color: '#E2E8F0', fontWeight: 'bold' }}>
                            {indicators.rsi ? parseFloat(indicators.rsi).toFixed(1) : '--'}
                        </div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: '#64748B', marginBottom: '2px' }}>VOLATILIDAD</div>
                        <div style={{ fontSize: '0.9rem', color: '#E2E8F0', fontWeight: 'bold' }}>
                            {intensity ? intensity : 'BAJA'}%
                        </div>
                    </div>
                </div>
            )}

        </motion.div>
    );
};

export default React.memo(SentinelCard);
