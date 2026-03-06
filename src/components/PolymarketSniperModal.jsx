import React, { useState, useEffect } from 'react';
import { X, TrendingUp, RefreshCw, Zap, Disc, AlertCircle, Trash2, LayoutGrid } from 'lucide-react';
import styles from './PolymarketSniperModal.module.css';
import { API_BASE } from '../config/api';

const PolymarketSniperModal = ({ isOpen, onClose }) => {
    const [activeTrades, setActiveTrades] = useState([]);
    const [history, setHistory] = useState([]);
    const [view, setView] = useState('live');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sniperActive, setSniperActive] = useState(false);
    const [balance, setBalance] = useState(1000);
    const [stakePercent, setStakePercent] = useState(5);
    const [hotEvents, setHotEvents] = useState([]);

    const syncWithBackend = async (action, payload) => {
        try {
            const res = await fetch(`${API_BASE}/api/polymarket-sniper`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, payload })
            });
            const data = await res.json();
            if (data.success) updateLocalState(data.state);
        } catch (e) { console.error("Sync error:", e); }
    };

    const updateLocalState = (s) => {
        setActiveTrades(s.activeTrades || []);
        setHistory(s.history || []);
        setSniperActive(s.sniperActive);
        setBalance(s.balance);
        setStakePercent(s.stakePercent);
        setHotEvents(s.hotEvents || []);
    };

    const fetchState = async () => {
        setLoading(activeTrades.length === 0);
        try {
            const res = await fetch(`${API_BASE}/api/polymarket-sniper`);
            const json = await res.json();
            if (json.success && json.state) {
                updateLocalState(json.state);
            }
        } catch (e) {
            setError("Error conectando con el motor de Polymarket.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchState();
            const interval = setInterval(fetchState, 10000); // Actualiza cada 10s
            return () => clearInterval(interval);
        }
    }, [isOpen]);

    const closeTradeManually = (tradeId) => {
        syncWithBackend('CLOSE_TRADE', { id: tradeId });
    };

    const clearHistory = () => {
        if (window.confirm("¿Estás seguro de que quieres borrar todo el historial?")) {
            syncWithBackend('CLEAR_HISTORY');
        }
    };

    const toggleSniper = () => {
        syncWithBackend('TOGGLE_SNIPER', !sniperActive);
    };

    const updateConfig = (newBalance, newStake) => {
        syncWithBackend('UPDATE_CONFIG', { balance: newBalance, stakePercent: newStake });
    };

    const totalProfitUSD = history.reduce((acc, sig) => acc + parseFloat(sig.profitUSD || 0), 0);
    const activeStakeTotal = activeTrades.reduce((acc, t) => acc + (t.stakeAmount || 0), 0);
    const availableBalance = balance - activeStakeTotal;

    const wins = history.filter(s => s.status === 'WIN').length;
    const winRate = history.length > 0 ? ((wins / history.length) * 100).toFixed(0) : 0;

    if (!isOpen) return null;

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
                <header className={styles.header}>
                    <div className={styles.titleArea}>
                        <LayoutGrid className={styles.polyIcon} size={24} color="#3B82F6" />
                        <h2>POLYMARKET IMBALANCE <span className={styles.polyTag}>BETA</span></h2>
                    </div>
                    <button className={styles.closeBtn} onClick={onClose}><X size={20} /></button>
                </header>

                <div className={styles.body}>
                    <div className={styles.viewToggle}>
                        <button
                            className={view === 'live' ? styles.activeTab : ''}
                            onClick={() => setView('live')}
                        >
                            BOT EN VIVO
                        </button>
                        <button
                            className={view === 'history' ? styles.activeTab : ''}
                            onClick={() => setView('history')}
                        >
                            HISTORIAL IMBALANCES
                        </button>
                    </div>

                    {view === 'live' ? (
                        <>
                            <div className={styles.controls}>
                                <div className={styles.statusBox}>
                                    <div className={styles.statusLabel}>DETECTOR DE DESEQUILIBRIO</div>
                                    <div className={sniperActive ? styles.statusActive : styles.statusIdle}>
                                        {sniperActive ? '🟢 ACTIVADO Y ANALIZANDO' : '⚪ EN ESPERA'}
                                    </div>
                                </div>
                                <button
                                    className={sniperActive ? styles.deactivateBtn : styles.activateBtn}
                                    onClick={toggleSniper}
                                >
                                    <Zap size={16} /> {sniperActive ? 'DETENER BOT' : 'BAJAR ALPHA'}
                                </button>
                            </div>

                            <div className={styles.bankrollConfig}>
                                <div className={styles.configItem}>
                                    <label>SALDO VIRTUAL (USD)</label>
                                    <div className={styles.inputWrap}>
                                        <input
                                            type="number"
                                            value={balance}
                                            onChange={(e) => setBalance(parseFloat(e.target.value) || 0)}
                                            onBlur={() => updateConfig(balance, stakePercent)}
                                        />
                                    </div>
                                </div>
                                <div className={styles.configItem}>
                                    <label>STAKE (%)</label>
                                    <div className={styles.inputWrap}>
                                        <input
                                            type="number"
                                            value={stakePercent}
                                            onChange={(e) => setStakePercent(parseInt(e.target.value) || 0)}
                                            onBlur={() => updateConfig(balance, stakePercent)}
                                        />
                                    </div>
                                </div>
                                <div className={styles.walletDisplay}>
                                    <div className={styles.walletLabel}>FONDOS TOTALES</div>
                                    <div className={styles.walletBalance}>${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                                    <div className={styles.availableRow}>
                                        <span>Libre: ${availableBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                </div>
                            </div>

                            <div className={styles.imbalanceSection}>
                                <div className={styles.sectionHeader}>
                                    <TrendingUp size={16} color="#3B82F6" />
                                    <span>OPORTUNIDADES DE DESEQUILIBRIO (ORDERBOOK)</span>
                                </div>

                                {activeTrades.length === 0 ? (
                                    <div className={styles.scanningArea}>
                                        <RefreshCw className={styles.spin} size={30} color="#3B82F6" />
                                        <p>Escaneando Orderbooks en tiempo real...</p>
                                    </div>
                                ) : (
                                    <div className={styles.tradeList}>
                                        {activeTrades.map(trade => (
                                            <div key={trade.id} className={styles.tradeCard}>
                                                <div className={styles.tradeTop}>
                                                    <span className={styles.marketTitle}>{trade.title}</span>
                                                    <div className={styles.pnlBox} style={{ color: parseFloat(trade.pnl) >= 0 ? '#10B981' : '#EF4444' }}>
                                                        {parseFloat(trade.pnl) >= 0 ? '+' : ''}{trade.pnl}%
                                                    </div>
                                                </div>
                                                <div className={styles.tradeDetails}>
                                                    <div className={styles.detail}>
                                                        <span>Ratio Imbalance:</span>
                                                        <span className={styles.ratioVal}>{trade.ratio}x Buy</span>
                                                    </div>
                                                    <button
                                                        className={styles.closeBtnSmall}
                                                        onClick={() => closeTradeManually(trade.id)}
                                                    >
                                                        CERRAR
                                                    </button>
                                                </div>
                                                <div className={styles.tradeFooter}>
                                                    <span>Inversión: ${trade.stakeAmount.toFixed(2)}</span>
                                                    <span className={styles.pulseTag}>📡 ANALYZING IMBALANCE</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* NUEVA SECCIÓN: EVENTOS CALIENTES */}
                            <div className={styles.hotEventsSection}>
                                <div className={styles.sectionHeader}>
                                    <Zap size={16} color="#3B82F6" />
                                    <span>EVENTOS CALIENTES MONITORIZADOS (POLYM_API)</span>
                                </div>
                                <div className={styles.hotList}>
                                    {hotEvents.map(event => (
                                        <div key={event.id} className={styles.hotCard}>
                                            <div className={styles.hotInfo}>
                                                <span className={styles.hotTitle}>{event.title}</span>
                                                <div className={styles.hotMeta}>
                                                    <span>Vol: ${parseFloat(event.volume || 0).toLocaleString()}</span>
                                                    <span>Precio SÍ: ${event.price}</span>
                                                </div>
                                            </div>
                                            <div className={styles.liveStatus}>
                                                <span className={styles.dot}></span> LIVE DATA
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className={styles.historySection}>
                            <div className={styles.historyStats}>
                                <div className={styles.stat}>
                                    <div className={styles.statLabel}>WIN RATE</div>
                                    <div className={styles.statVal}>{winRate}%</div>
                                </div>
                                <div className={styles.stat}>
                                    <div className={styles.statLabel}>GANANCIA TOTAL</div>
                                    <div className={styles.statVal} style={{ color: totalProfitUSD >= 0 ? '#10B981' : '#EF4444' }}>
                                        ${totalProfitUSD.toFixed(2)}
                                    </div>
                                </div>
                                <button className={styles.clearBtn} onClick={clearHistory}>
                                    <Trash2 size={16} /> REINICIAR
                                </button>
                            </div>

                            <div className={styles.historyList}>
                                {history.length === 0 ? (
                                    <div className={styles.empty}>No hay historial de Polymarket.</div>
                                ) : (
                                    history.map(item => (
                                        <div key={item.id} className={styles.historyCard}>
                                            <div className={styles.histInfo}>
                                                <span className={styles.histTitle}>{item.title}</span>
                                                <span className={styles.histTime}>{item.time}</span>
                                            </div>
                                            <div className={styles.histResult} style={{ color: item.status === 'WIN' ? '#10B981' : '#EF4444' }}>
                                                {item.pnl} (${item.profitUSD})
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <footer className={styles.footer}>
                    <div className={styles.footerInfo}>
                        <AlertCircle size={14} />
                        <span>Detector de desequilibrios mediante Gamma & CLOB API de Polymarket.</span>
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default PolymarketSniperModal;
