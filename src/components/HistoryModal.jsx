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
            backgroundColor: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000200
        }} onClick={onClose}>

            <div style={{
                width: '100%', maxWidth: '440px', height: '90vh',
                background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.03))',
                backgroundColor: 'rgba(15, 15, 25, 0.5)',
                borderRadius: '35px',
                border: '1px solid rgba(255,255,255,0.15)',
                backdropFilter: 'blur(30px)',
                WebkitBackdropFilter: 'blur(30px)',
                position: 'relative', overflow: 'hidden',
                display: 'flex', flexDirection: 'column', color: '#fff',
                boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.8)'
            }} onClick={e => e.stopPropagation()}>

                {/* --- HEADER --- */}
                <div style={{ padding: '25px 25px 15px' }}>
                    <button onClick={onClose} style={{
                        width: '35px', height: '35px', borderRadius: '50%', background: '#fff',
                        border: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center',
                        cursor: 'pointer', marginBottom: '15px'
                    }}>
                        <X size={20} color="#000" />
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <Clock size={28} color="#10B981" />
                        <h1 style={{ fontSize: '1.4rem', fontWeight: '900', color: '#FCD34D', margin: 0 }}>
                            HISTORIAL DE TRADES ({mode})
                        </h1>
                    </div>
                </div>

                {/* --- FILTER SLIDER --- */}
                <div style={{ padding: '0 25px 15px', display: 'flex', gap: '8px', overflowX: 'auto', whiteSpace: 'nowrap' }} className="no-scrollbar">
                    {['ALL', 'TODAY', 'YESTERDAY', 'WEEK', 'MONTH', 'CUSTOM'].map(f => (
                        <button key={f} onClick={() => setFilter(f)} style={{
                            padding: '8px 16px', borderRadius: '10px', border: 'none',
                            fontSize: '0.75rem', fontWeight: '900', cursor: 'pointer',
                            background: filter === f ? '#10B981' : 'rgba(255,255,255,0.08)',
                            color: filter === f ? '#fff' : '#94A3B8',
                            transition: '0.2s all'
                        }}>
                            {{
                                'ALL': 'TODO', 'TODAY': 'HOY', 'YESTERDAY': 'AYER',
                                'WEEK': 'SEMANA', 'MONTH': 'MES', 'CUSTOM': 'RANGO'
                            }[f]}
                        </button>
                    ))}
                </div>

                {/* --- SUMMARY BOX --- */}
                <div style={{
                    margin: '0 25px 20px', padding: '15px',
                    background: 'rgba(16, 185, 129, 0.1)',
                    borderRadius: '20px',
                    border: '1px solid rgba(16, 185, 129, 0.2)',
                    backdropFilter: 'blur(10px)',
                    WebkitBackdropFilter: 'blur(10px)',
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px'
                }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.6rem', color: '#10B981', fontWeight: 'bold' }}>UTILIDAD NETA</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#10B981' }}>+${totalUsd.toFixed(2)}</div>
                        <div style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.3)' }}>DEL PERIODO</div>
                    </div>
                    <div style={{ textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
                        <div style={{ fontSize: '0.6rem', color: '#10B981', fontWeight: 'bold' }}>CRECIMIENTO</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#10B981' }}>+{roeAccount.toFixed(2)}%</div>
                        <div style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.3)' }}>BASE: ${accountBase.toFixed(2)}</div>
                    </div>
                    <div style={{ textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
                        <div style={{ fontSize: '0.6rem', color: '#10B981', fontWeight: 'bold' }}>GANANCIA X $1</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#10B981' }}>${profitPerDollar.toFixed(4)}</div>
                        <div style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.3)' }}>RENDIMIENTO VIVO</div>
                    </div>
                </div>

                {/* --- HISTORY LIST --- */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '0 25px 25px' }} className="no-scrollbar">
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>Cargando...</div>
                    ) : filteredHistory.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>Sin registros</div>
                    ) : (
                        filteredHistory.map((trade, i) => {
                            const profit = trade.profitUsd || 0;
                            const isWin = profit >= 0;
                            const symbol = trade.symbol.replace('USDT', '');
                            const invested = (Math.abs(profit) / (Math.abs(trade.pnl || 1) / 100)) || 0;

                            // --- MOTOR DE IDENTIDAD VISUAL (TOP 20 + FAVORITOS) ---
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

                            const theme = coinThemes[symbol] || { icon: '💎', color: '#10B981' };
                            const coinColor = theme.color;
                            const coinEmoji = theme.icon;

                            return (
                                <div key={i} style={{
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    borderRadius: '25px',
                                    padding: '18px',
                                    marginBottom: '15px',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    backdropFilter: 'blur(15px)',
                                    WebkitBackdropFilter: 'blur(15px)',
                                    position: 'relative',
                                    overflow: 'hidden',
                                    boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
                                }}>
                                    {/* Glass Highlight Line */}
                                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)' }}></div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '15px' }}>
                                        {/* CIRCLE ICON WITH GLOW */}
                                        <div style={{
                                            width: '45px', height: '45px', borderRadius: '15px',
                                            background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center',
                                            boxShadow: `0 0 15px ${coinColor}33`, border: `1px solid ${coinColor}44`,
                                            fontSize: '20px'
                                        }}>
                                            {coinEmoji}
                                        </div>

                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                                <span style={{ fontSize: '1.2rem', fontWeight: '900', letterSpacing: '-0.5px' }}>{symbol}</span>
                                                <span style={{ fontSize: '0.6rem', padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '6px', color: '#94A3B8', fontWeight: 'bold' }}>VORTEX</span>
                                                <span style={{ fontSize: '0.6rem', padding: '2px 6px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '6px', color: '#F59E0B', fontWeight: 'bold' }}>AUTO</span>
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: isWin ? '#10B981' : '#EF4444', fontWeight: 'bold' }}>
                                                {isWin ? '↗' : '↘'} {Math.abs(trade.pnl || 0).toFixed(2)}%
                                            </div>
                                        </div>

                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontSize: '1.3rem', fontWeight: '900', color: isWin ? '#10B981' : '#EF4444' }}>
                                                {isWin ? '+' : ''}${profit.toFixed(2)}
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <div style={{ background: 'rgba(0,217,255,0.1)', color: '#00D9FF', fontSize: '0.65rem', padding: '5px 12px', borderRadius: '10px', fontWeight: 'bold', border: '1px solid rgba(0,217,255,0.1)' }}>
                                                INVERTIDO: ${invested.toFixed(2)}
                                            </div>
                                            <div style={{ background: 'rgba(255,255,255,0.05)', color: '#10B981', fontSize: '0.65rem', padding: '5px 12px', borderRadius: '10px', fontWeight: 'bold' }}>
                                                ⏱️ {(() => {
                                                    const diff = new Date(trade.timestamp) - new Date(trade.entryTimestamp);
                                                    const h = Math.floor(diff / 3600000);
                                                    const m = Math.floor((diff % 3600000) / 60000);
                                                    return h > 0 ? `${h}h ${m}m` : `${m}m ${Math.floor((diff % 60000) / 1000)}s`;
                                                })()}
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{
                                        background: 'rgba(0,0,0,0.3)',
                                        padding: '10px 15px',
                                        borderRadius: '12px',
                                        display: 'flex',
                                        justifyContent: 'center',
                                        gap: '15px',
                                        fontSize: '0.7rem',
                                        color: 'rgba(255,255,255,0.4)',
                                        border: '1px solid rgba(255,255,255,0.03)'
                                    }}>
                                        <span>OPEN: <b style={{ color: '#fff' }}>{new Date(trade.entryTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b></span>
                                        <span style={{ color: 'rgba(255,255,255,0.1)' }}>|</span>
                                        <span>CLOSE: <b style={{ color: '#fff' }}>{new Date(trade.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b></span>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

export default HistoryModal;
