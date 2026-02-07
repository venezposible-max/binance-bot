import React, { useEffect, useState } from 'react';
import { API_BASE } from '../config/api';

import styles from './DocumentationModal.module.css'; // Re-use styles for consistency
import { X, TrendingUp, TrendingDown, Clock, Activity } from 'lucide-react';

const HistoryModal = ({ isOpen, onClose, mode }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);

    // 📅 FILTER STATE (MT5 Style)
    const [filter, setFilter] = useState('ALL'); // ALL, TODAY, YESTERDAY, WEEK, MONTH, CUSTOM
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');

    // Derived Filtered Data
    const filteredHistory = React.useMemo(() => {
        if (!history || history.length === 0) return [];

        const now = new Date();
        // Reset time to midnight for clean comparison
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        return history.filter(t => {
            const tTime = new Date(t.timestamp).getTime();

            switch (filter) {
                case 'TODAY':
                    return tTime >= todayStart;
                case 'YESTERDAY':
                    return tTime >= (todayStart - 86400000) && tTime < todayStart;
                case 'WEEK':
                    // Last 7 days
                    return tTime >= (todayStart - (7 * 86400000));
                case 'MONTH':
                    // Current Month (1st to now)
                    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
                    return tTime >= monthStart;
                case 'CUSTOM':
                    if (!customStart) return true;
                    const start = new Date(customStart).getTime();
                    const end = customEnd ? new Date(customEnd).getTime() + 86400000 : Infinity; // End of day
                    return tTime >= start && tTime < end;
                default:
                    return true;
            }
        });
    }, [history, filter, customStart, customEnd]);

    const fetchHistory = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/get-status?mode=${mode}`);
            if (res.ok) {
                const data = await res.json();
                // Sort by newest first
                const sorted = (data.history || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                setHistory(sorted);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) fetchHistory();
    }, [isOpen, mode]);

    if (!isOpen) return null;

    return (
        <div className={styles.overlay} onClick={onClose} style={{ zIndex: 1000200 }}>
            <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: '800px' }}>
                <button className={styles.closeButton} onClick={onClose}>
                    <X size={24} />
                </button>

                <div className={styles.content}>
                    <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Clock size={28} color="var(--neon-cyan)" />
                        HISTORIAL DE TRADES ({mode})
                    </h1>

                    {/* FILTER TOOLBAR */}
                    <div style={{ marginBottom: '15px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {['ALL', 'TODAY', 'YESTERDAY', 'WEEK', 'MONTH', 'CUSTOM'].map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                style={{
                                    padding: '6px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                                    fontSize: '0.8rem', fontWeight: 'bold',
                                    background: filter === f ? '#10B981' : 'rgba(255,255,255,0.1)',
                                    color: filter === f ? '#fff' : '#94A3B8'
                                }}
                            >
                                {{
                                    'ALL': 'TODO', 'TODAY': 'HOY', 'YESTERDAY': 'AYER',
                                    'WEEK': 'SEMANA', 'MONTH': 'MES', 'CUSTOM': 'RANGO'
                                }[f]}
                            </button>
                        ))}
                    </div>

                    {/* CUSTOM DATE PICKERS */}
                    {filter === 'CUSTOM' && (
                        <div style={{ marginBottom: '15px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ background: '#334155', border: 'none', padding: '6px', color: '#fff', borderRadius: '4px' }} />
                            <span style={{ color: '#94A3B8' }}>➜</span>
                            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{ background: '#334155', border: 'none', padding: '6px', color: '#fff', borderRadius: '4px' }} />
                        </div>
                    )}

                    {/* NEW: SUMMARY HEADER */}
                    {!loading && filteredHistory.length > 0 && (() => {
                        const totalUsd = filteredHistory.reduce((acc, t) => acc + (t.profitUsd || 0), 0);
                        const totalPct = filteredHistory.reduce((acc, t) => acc + (t.pnl || 0), 0); // Simple sum as requested

                        return (
                            <div style={{
                                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px',
                                padding: '15px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '12px',
                                border: '1px solid rgba(16, 185, 129, 0.2)'
                            }}>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.8rem', color: '#A7F3D0', fontWeight: 'bold', marginBottom: '4px' }}>Utilidad Neta (USD)</div>
                                    <div style={{ fontSize: '1.4rem', color: totalUsd >= 0 ? '#10B981' : '#EF4444', fontWeight: 'bold' }}>
                                        {totalUsd >= 0 ? '+' : ''}${totalUsd.toFixed(2)}
                                    </div>
                                </div>
                                <div style={{ textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
                                    <div style={{ fontSize: '0.8rem', color: '#A7F3D0', fontWeight: 'bold', marginBottom: '4px' }}>Rendimiento de Estrategia</div>
                                    <div style={{ fontSize: '1.4rem', color: totalPct >= 0 ? '#10B981' : '#EF4444', fontWeight: 'bold' }}>
                                        {totalPct >= 0 ? '+' : ''}{totalPct.toFixed(2)}%
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    <div className={styles.section}>
                        {loading ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Cargando historial...</div>
                        ) : filteredHistory.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#666', fontStyle: 'italic' }}>
                                No hay trades en este periodo.
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {filteredHistory.map((trade, idx) => (
                                    <div key={idx} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '15px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px',
                                        borderLeft: `4px solid ${trade.profitUsd >= 0 ? '#10B981' : '#EF4444'}`
                                    }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                                            {/* TOP ROW: Main Info */}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#fff' }}>
                                                        {trade.symbol.replace('USDT', '')}
                                                    </div>
                                                    <div style={{
                                                        fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px',
                                                        background: 'rgba(255,255,255,0.1)', color: '#ccc'
                                                    }}>
                                                        {trade.strategy || 'MANUAL'}
                                                    </div>

                                                    {/* DURATION PILL (New Location) */}
                                                    {trade.entryTimestamp && (
                                                        <div style={{
                                                            fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px',
                                                            background: 'rgba(16, 185, 129, 0.1)', color: '#10B981', fontWeight: 'bold'
                                                        }}>
                                                            ⏱️ {(() => {
                                                                const start = new Date(trade.entryTimestamp);
                                                                const end = new Date(trade.timestamp);
                                                                if (isNaN(start.getTime()) || isNaN(end.getTime())) return "--";

                                                                const diff = end - start;
                                                                const h = Math.floor(diff / 3600000);
                                                                const m = Math.floor((diff % 3600000) / 60000);
                                                                const s = Math.floor((diff % 60000) / 1000);
                                                                if (h > 0) return `${h}h ${m}m`;
                                                                if (m > 0) return `${m}m ${s}s`;
                                                                return `${s}s`;
                                                            })()}
                                                        </div>
                                                    )}
                                                </div>

                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{
                                                        fontWeight: 'bold', fontSize: '1.1rem',
                                                        color: trade.profitUsd >= 0 ? '#10B981' : '#EF4444'
                                                    }}>
                                                        {trade.profitUsd >= 0 ? '+' : ''}${trade.profitUsd.toFixed(2)}
                                                    </div>
                                                    <div style={{ fontSize: '0.8rem', color: trade.pnl >= 0 ? '#A7F3D0' : '#FECACA' }}>
                                                        {trade.pnl.toFixed(2)}%
                                                    </div>
                                                </div>
                                            </div>

                                            {/* BOTTOM ROW: Time Details */}
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: '15px',
                                                fontSize: '0.75rem', color: '#94A3B8',
                                                background: 'rgba(0,0,0,0.2)', padding: '6px', borderRadius: '6px'
                                            }}>
                                                {trade.entryTimestamp ? (
                                                    <>
                                                        <span>
                                                            OPEN: <span style={{ color: '#fff' }}>{new Date(trade.entryTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                        </span>
                                                        <span>➜</span>
                                                        <span>
                                                            CLOSE: <span style={{ color: '#fff' }}>{new Date(trade.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span>📅 {new Date(trade.timestamp).toLocaleString()} (Old Trade)</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default HistoryModal;
