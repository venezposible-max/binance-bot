import React, { useEffect, useState } from 'react';
import styles from './DocumentationModal.module.css'; // Re-use styles for consistency
import { X, TrendingUp, TrendingDown, Clock, Activity } from 'lucide-react';

const HistoryModal = ({ isOpen, onClose, mode }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);

    const fetchHistory = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/get-status?mode=${mode}`);
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

                    <div className={styles.section}>
                        {loading ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Cargando historial...</div>
                        ) : history.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#666', fontStyle: 'italic' }}>
                                No hay trades cerrados en este historial.
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {history.map((trade, idx) => (
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
                                                        <span style={{ color: '#E2E8F0', fontWeight: 'bold' }}>
                                                            ⏱️ {(() => {
                                                                const start = new Date(trade.entryTimestamp);
                                                                const end = new Date(trade.timestamp);
                                                                if (isNaN(start.getTime()) || isNaN(end.getTime())) return "--";

                                                                const diff = end - start;
                                                                const h = Math.floor(diff / 3600000);
                                                                const m = Math.floor((diff % 3600000) / 60000);
                                                                const s = Math.floor((diff % 60000) / 1000); // Added seconds
                                                                if (h > 0) return `${h}h ${m}m`;
                                                                if (m > 0) return `${m}m ${s}s`;
                                                                return `${s}s`;
                                                            })()}
                                                        </span>
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
