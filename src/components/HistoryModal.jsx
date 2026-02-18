import React, { useEffect, useState } from 'react';
import { API_BASE } from '../config/api';
import styles from './DocumentationModal.module.css'; // Re-use styles for consistency
import { X, Clock } from 'lucide-react';

const HistoryModal = ({ isOpen, onClose, mode, binanceBalance, walletConfig, activeTrades, marketData }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('ALL');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');

    const filteredHistory = React.useMemo(() => {
        if (!history || history.length === 0) return [];
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        return history.filter(t => {
            const tTime = new Date(t.timestamp).getTime();
            switch (filter) {
                case 'TODAY': return tTime >= todayStart;
                case 'YESTERDAY': return tTime >= (todayStart - 86400000) && tTime < todayStart;
                case 'WEEK': return tTime >= (todayStart - (7 * 86400000));
                case 'MONTH': return tTime >= new Date(now.getFullYear(), now.getMonth(), 1).getTime();
                case 'CUSTOM':
                    if (!customStart) return true;
                    const start = new Date(customStart).getTime();
                    const end = customEnd ? new Date(customEnd).getTime() + 86400000 : Infinity;
                    return tTime >= start && tTime < end;
                default: return true;
            }
        });
    }, [history, filter, customStart, customEnd]);

    const fetchHistory = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/get-status?mode=${mode}`);
            if (res.ok) {
                const data = await res.json();
                setHistory((data.history || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
            }
        } catch (e) { console.error(e); } finally { setLoading(false); }
    };

    useEffect(() => { if (isOpen) fetchHistory(); }, [isOpen, mode]);

    if (!isOpen) return null;

    // --- CÁLCULOS DINÁMICOS ---
    const { totalUsd, totalInvestedVolume } = filteredHistory.reduce((acc, t) => {
        const profit = parseFloat(t.profitUsd) || 0;
        const pnlPct = parseFloat(t.pnl) || 0;
        const invested = pnlPct !== 0 ? (Math.abs(profit) / (Math.abs(pnlPct) / 100)) : 0;
        return { totalUsd: acc.totalUsd + profit, totalInvestedVolume: acc.totalInvestedVolume + invested };
    }, { totalUsd: 0, totalInvestedVolume: 0 });

    const isLive = mode === 'LIVE';
    let currentEquity = isLive ? (binanceBalance?.total || 0) : (walletConfig?.currentBalance || 1000);
    if (isLive && activeTrades && marketData) {
        activeTrades.forEach(t => {
            const currentPrice = marketData[t.symbol]?.price;
            if (currentPrice && t.investedAmount) {
                const pnlPct = (t.type === 'SHORT' ? (t.entryPrice - currentPrice) / t.entryPrice : (currentPrice - t.entryPrice) / t.entryPrice);
                currentEquity += t.investedAmount * (1 + pnlPct);
            } else if (t.investedAmount) { currentEquity += t.investedAmount; }
        });
    }
    const accountBase = isLive ? currentEquity : (walletConfig?.initialBalance || 1000);
    const roeAccount = (totalUsd / accountBase) * 100;
    const profitPerDollar = totalInvestedVolume > 0 ? (totalUsd / totalInvestedVolume) : 0;

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
            display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000200
        }} onClick={onClose}>

            <div style={{
                width: '100%', maxWidth: '420px', height: '90vh',
                backgroundColor: 'rgba(23, 23, 33, 0.7)',
                borderRadius: '40px', border: '1px solid rgba(255,255,255,0.1)',
                backdropFilter: 'blur(20px)', position: 'relative', overflow: 'hidden',
                display: 'flex', flexDirection: 'column', color: '#fff',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
            }} onClick={e => e.stopPropagation()}>

                {/* --- MOCK STATUS BAR (iOS Style for Premium Feel) --- */}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 30px 10px', fontSize: '13px', color: '#fff', fontWeight: '600' }}>
                    <span>9:41</span>
                    <div style={{ display: 'flex', gap: '5px' }}>📶 🔋</div>
                </div>

                {/* --- HEADER SUMMARY CARD --- */}
                <div style={{
                    margin: '10px 20px', padding: '15px 20px',
                    background: 'rgba(255,255,255,0.05)', borderRadius: '25px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                    <div>
                        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>Balance</div>
                        <div style={{ fontSize: '18px', fontWeight: 'bold' }}>${currentEquity.toFixed(2)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>ROE Mensual</div>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: roeAccount >= 0 ? '#10B981' : '#EF4444' }}>
                            {roeAccount >= 0 ? '+' : ''}{roeAccount.toFixed(2)}% ↗
                        </div>
                    </div>
                </div>

                {/* --- MOCK NAVIGATION (Static from image) --- */}
                <div style={{ display: 'flex', justifyContent: 'space-around', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    {['🏠', '📊', '⇄', '🕒', '👤'].map((icon, i) => (
                        <div key={i} style={{
                            fontSize: '20px', padding: '10px', borderRadius: '15px',
                            background: i === 3 ? 'rgba(255,255,255,0.1)' : 'transparent',
                            cursor: 'pointer'
                        }}>{icon}</div>
                    ))}
                </div>

                {/* --- TRADE HISTORY TITLE --- */}
                <div style={{ padding: '20px 25px 10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ background: 'rgba(16, 185, 129, 0.2)', padding: '5px', borderRadius: '8px' }}>
                        <Clock size={18} color="#10B981" />
                    </div>
                    <span style={{ fontSize: '18px', fontWeight: 'bold' }}>Historial Operativo</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '5px' }}>
                        {['TODAY', 'WEEK', 'ALL'].map(f => (
                            <button key={f} onClick={() => setFilter(f)} style={{
                                background: filter === f ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                                border: 'none', color: filter === f ? '#10B981' : 'rgba(255,255,255,0.4)',
                                fontSize: '10px', fontWeight: 'bold', padding: '4px 8px', borderRadius: '5px', cursor: 'pointer'
                            }}>
                                {f}
                            </button>
                        ))}
                    </div>
                </div>

                {/* --- SCROLLABLE CONTENT --- */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(255,255,255,0.3)' }}>Sincronizando...</div>
                    ) : filteredHistory.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>Sin operaciones registradas</div>
                    ) : (
                        filteredHistory.map((trade, i) => {
                            const pnlPct = trade.pnl || 0;
                            const profit = trade.profitUsd || 0;
                            const isWin = profit >= 0;
                            const symbol = trade.symbol.replace('USDT', '');
                            const invested = pnlPct !== 0 ? (Math.abs(profit) / (Math.abs(pnlPct) / 100)) : 0;

                            // Determinamos color de la moneda (para el glow de la imagen)
                            const coinColor = symbol === 'DOGE' ? '#E1B31E' : symbol === 'ORCA' ? '#00D9FF' : symbol === 'ETH' ? '#627EEA' : '#10B981';

                            return (
                                <div key={i} style={{
                                    background: 'rgba(255,255,255,0.03)', borderRadius: '25px', padding: '15px',
                                    border: '1px solid rgba(255,255,255,0.05)', position: 'relative'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                        {/* Icon Container with Coin Specific Glow */}
                                        <div style={{
                                            width: '45px', height: '45px', borderRadius: '15px',
                                            background: 'rgba(0,0,0,0.3)', display: 'flex', justifyContent: 'center', alignItems: 'center',
                                            boxShadow: `0 0 15px ${coinColor}33`, border: `1px solid ${coinColor}44`, fontSize: '20px'
                                        }}>
                                            {symbol === 'DOGE' ? '🐶' : symbol === 'ETH' ? '💠' : symbol === 'NEAR' ? 'Ⓝ' : '💎'}
                                        </div>

                                        <div>
                                            <div style={{ fontWeight: 'bold', fontSize: '16px' }}>{symbol}</div>
                                            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <Clock size={10} /> {(() => {
                                                    const diff = new Date(trade.timestamp) - new Date(trade.entryTimestamp);
                                                    const m = Math.floor(diff / 60000);
                                                    return m > 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
                                                })()}
                                            </div>
                                        </div>

                                        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                                            <div style={{ fontSize: '18px', fontWeight: 'bold', color: isWin ? '#10B981' : '#EF4444' }}>
                                                {isWin ? '+' : ''}${profit.toFixed(2)}
                                            </div>
                                            <div style={{ fontSize: '12px', color: isWin ? '#10B981' : '#EF4444', fontWeight: '600' }}>
                                                {pnlPct.toFixed(2)}%
                                            </div>
                                        </div>
                                    </div>

                                    {/* Invested Label (Box at the bottom matching image) */}
                                    <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                                        <div style={{
                                            background: 'rgba(255,255,255,0.05)', padding: '6px 15px', borderRadius: '12px',
                                            fontSize: '11px', fontWeight: 'bold', color: 'rgba(255,255,255,0.7)',
                                            borderBottom: `2px solid ${coinColor}`, display: 'flex', gap: '10px'
                                        }}>
                                            <span>Invested: ${invested.toFixed(2)}</span>
                                            <span style={{ color: coinColor }}>↗</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* --- FOOTER BUTTON --- */}
                <div style={{ padding: '20px', background: 'rgba(23, 23, 33, 0.9)', backdropFilter: 'blur(5px)' }}>
                    <button style={{
                        width: '100%', padding: '16px', borderRadius: '20px',
                        background: 'linear-gradient(90deg, #10B981 0%, #059669 100%)',
                        color: '#fff', border: 'none', fontWeight: 'bold', fontSize: '16px',
                        boxShadow: '0 10px 20px rgba(16, 185, 129, 0.3)', cursor: 'pointer'
                    }}>
                        New Trade
                    </button>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '15px', padding: '0 10px' }}>
                        <span style={{ cursor: 'pointer' }}>⚙️</span>
                        <span style={{ cursor: 'pointer' }}>❓</span>
                    </div>
                </div>

                {/* Close Button (Floating) */}
                <button onClick={onClose} style={{
                    position: 'absolute', top: '15px', right: '15px',
                    background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff',
                    width: '30px', height: '30px', borderRadius: '50%', cursor: 'pointer', zIndex: 10
                }}>✕</button>

            </div>
        </div>
    );
};

export default HistoryModal;
