import React, { useState } from 'react';
import styles from './UnixaBacktestModal.module.css';
import { API_BASE } from '../config/api';

const UnixaBacktestModal = ({ isOpen, onClose }) => {
    const [capital, setCapital] = useState(1000);
    const [risk, setRisk] = useState(10);
    const [maxTrades, setMaxTrades] = useState(3);
    const [range, setRange] = useState('24h');

    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const runBacktest = async () => {
        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const res = await fetch(`${API_BASE}/api/unixa-backtest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    capital, risk, maxTrades, range
                })
            });

            if (!res.ok) throw new Error('Error al ejecutar backtest');
            const data = await res.json();
            setResult(data);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
                <div className={styles.header}>
                    <h2>🧪 BACKTEST UNIXA REALISTA ({range.toUpperCase()})</h2>
                    <button className={styles.closeBtn} onClick={onClose}>×</button>
                </div>

                <p style={{ color: '#94A3B8', fontSize: '0.85rem', marginBottom: '20px', lineHeight: '1.4' }}>
                    Simula la estrategía de pánico institucional (UNIXA Config Óptima #1) en las condiciones exactas del mercado de las últimas {range === '24h' ? '24 horas' : range === '48h' ? '48 horas' : range === '1w' ? '7 días' : '30 días'} para estimar rentabilidad futura.
                </p>

                <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 120px' }}>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: '#64748B', marginBottom: '5px', fontWeight: 'bold' }}>Capital Base ($)</label>
                        <input
                            type="number"
                            value={capital}
                            onChange={(e) => setCapital(e.target.value)}
                            style={{ width: '100%', padding: '10px', background: 'rgba(0,0,0,0.3)', border: '1px solid #334155', borderRadius: '8px', color: '#fff', fontSize: '1rem' }}
                        />
                    </div>
                    <div style={{ flex: '1 1 120px' }}>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: '#64748B', marginBottom: '5px', fontWeight: 'bold' }}>Riesgo/Operación (%)</label>
                        <input
                            type="number"
                            value={risk}
                            onChange={(e) => setRisk(e.target.value)}
                            style={{ width: '100%', padding: '10px', background: 'rgba(0,0,0,0.3)', border: '1px solid #334155', borderRadius: '8px', color: '#fff', fontSize: '1rem' }}
                        />
                    </div>
                    <div style={{ flex: '1 1 120px' }}>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: '#64748B', marginBottom: '5px', fontWeight: 'bold' }}>Trades Simultáneos</label>
                        <input
                            type="number"
                            value={maxTrades}
                            onChange={(e) => setMaxTrades(e.target.value)}
                            style={{ width: '100%', padding: '10px', background: 'rgba(0,0,0,0.3)', border: '1px solid #334155', borderRadius: '8px', color: '#fff', fontSize: '1rem' }}
                        />
                    </div>
                    <div style={{ flex: '1 1 120px' }}>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: '#64748B', marginBottom: '5px', fontWeight: 'bold' }}>Rango Histórico</label>
                        <select
                            value={range}
                            onChange={(e) => setRange(e.target.value)}
                            style={{ width: '100%', padding: '10px', background: 'rgba(0,0,0,0.3)', border: '1px solid #334155', borderRadius: '8px', color: '#fff', fontSize: '1rem', cursor: 'pointer' }}
                        >
                            <option value="24h">Últimas 24 Horas</option>
                            <option value="48h">Últimas 48 Horas</option>
                        </select>
                    </div>
                </div>

                <button
                    onClick={runBacktest}
                    disabled={loading}
                    style={{
                        width: '100%', padding: '15px', borderRadius: '8px',
                        background: loading ? '#334155' : 'linear-gradient(90deg, #F59E0B, #EA580C)',
                        color: '#fff', border: 'none', fontWeight: 'bold', fontSize: '1rem',
                        cursor: loading ? 'not-allowed' : 'pointer', transition: 'all 0.2s'
                    }}
                >
                    {loading ? '⏳ PROCESANDO SIMULACIÓN...' : `🚀 EJECUTAR BACKTEST (${range.toUpperCase()})`}
                </button>

                {error && <div style={{ background: 'rgba(239,68,68,0.2)', color: '#F87171', padding: '10px', borderRadius: '8px', marginTop: '20px', textAlign: 'center' }}>{error}</div>}

                {result && (
                    <div style={{ marginTop: '25px', borderTop: '1px solid #334155', paddingTop: '20px' }}>
                        <h3 style={{ color: '#FBBF24', textAlign: 'center', marginBottom: '20px', fontSize: '1.2rem' }}>
                            RESULTADOS ESTIMADOS
                        </h3>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px', marginBottom: '20px' }}>
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '12px', border: '1px solid #334155', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.75rem', color: '#64748B', marginBottom: '5px', fontWeight: 'bold' }}>EQUITY FINAL</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: result.netProfitUsd > 0 ? '#10B981' : '#EF4444' }}>
                                    ${result.finalEquity.toFixed(2)}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: result.netProfitPct > 0 ? '#10B981' : '#EF4444' }}>
                                    {result.netProfitPct > 0 ? '+' : ''}{result.netProfitPct.toFixed(2)}%
                                </div>
                            </div>
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '12px', border: '1px solid #334155', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.75rem', color: '#64748B', marginBottom: '5px', fontWeight: 'bold' }}>WIN RATE</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#22D3EE' }}>
                                    {result.winRate.toFixed(1)}%
                                </div>
                                <div style={{ fontSize: '0.8rem', color: '#94A3B8' }}>
                                    {result.wins}W / {result.losses}L
                                </div>
                            </div>
                        </div>

                        <div style={{ fontSize: '0.9rem', color: '#E2E8F0', marginBottom: '10px' }}>
                            <strong>Operaciones Realizadas:</strong> {result.totalTrades}
                        </div>

                        {/* LISTA DE TRADES */}
                        {result.trades && result.trades.length > 0 ? (
                            <div style={{ maxHeight: '250px', overflowY: 'auto', paddingRight: '10px' }}>
                                {result.trades.map((t, i) => (
                                    <div key={i} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', marginBottom: '8px',
                                        borderLeft: `3px solid ${t.pnlUsd > 0 ? '#10B981' : '#EF4444'}`
                                    }}>
                                        <div>
                                            <div style={{ fontWeight: 'bold', color: '#fff', fontSize: '0.95rem' }}>{t.symbol}</div>
                                            <div style={{ fontSize: '0.7rem', color: '#94A3B8', marginTop: '3px' }}>{t.durationMins} min | {t.reason}</div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontWeight: 'bold', color: t.pnlUsd > 0 ? '#10B981' : '#EF4444' }}>
                                                {t.pnlUsd > 0 ? '+' : ''}${t.pnlUsd.toFixed(2)}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', color: '#64748B', padding: '20px' }}>No se ejecutaron operaciones de pánico en las últimas 24h.</div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default UnixaBacktestModal;
