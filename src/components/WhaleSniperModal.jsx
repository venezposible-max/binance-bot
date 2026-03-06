import React, { useState, useEffect } from 'react';
import { X, Radar, TrendingUp, RefreshCw, Zap, Disc, AlertCircle, Trash2, Power } from 'lucide-react';
import styles from './WhaleSniperModal.module.css';
import { API_BASE } from '../config/api';

const WhaleSniperModal = ({ isOpen, onClose }) => {
    const [whales, setWhales] = useState([]);
    const [activeTrades, setActiveTrades] = useState([]);
    const [history, setHistory] = useState([]);
    const [view, setView] = useState('live');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sniperActive, setSniperActive] = useState(false);
    const [balance, setBalance] = useState(1000);
    const [stakePercent, setStakePercent] = useState(10);
    const [minWhaleSol, setMinWhaleSol] = useState(10);
    const [isEditing, setIsEditing] = useState(false);

    const syncWithBackend = async (action, payload) => {
        try {
            const res = await fetch(`${API_BASE}/api/whale-sniper`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, payload })
            });
            const data = await res.json();
            if (data.success) updateLocalState(data.state);
        } catch (e) { console.error("Sync error:", e); }
    };

    const updateLocalState = (s) => {
        if (!s) return;
        setActiveTrades(s.activeTrades || []);
        setHistory(s.history || []);
        setSniperActive(Boolean(s.sniperActive));

        if (!isEditing) {
            setBalance(s.balance || 1000);
            setStakePercent(s.stakePercent || 10);
            setMinWhaleSol(s.minWhaleSol || 10);
        }
    };

    const fetchWhales = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/whale-sniper`);
            const json = await res.json();
            if (json.success) {
                setWhales(json.whales || []);
                if (json.state) updateLocalState(json.state);
            }
        } catch (e) {
            setError("Error conectando con el servidor de señales.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchWhales();
            const interval = setInterval(fetchWhales, 5000);
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
        const nextState = !sniperActive;
        setSniperActive(nextState);
        syncWithBackend('TOGGLE_SNIPER', nextState);
    };

    const updateConfig = (newBalance, newStake, newMinWhale) => {
        syncWithBackend('UPDATE_CONFIG', {
            balance: newBalance,
            stakePercent: newStake,
            minWhaleSol: newMinWhale
        });
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
                        <Radar className={styles.radarIcon} size={24} color="#9945FF" />
                        <h2>WHALE SNIPER v1 <span className={styles.solanaTag}>SOLANA</span></h2>
                    </div>
                    <div className={styles.headerActions}>
                        <button
                            className={sniperActive ? styles.powerBtnActive : styles.powerBtnIdle}
                            onClick={toggleSniper}
                            title={sniperActive ? "Bot Encendido" : "Bot Apagado"}
                        >
                            <Power size={18} />
                            <span>{sniperActive ? 'BOT ON' : 'BOT OFF'}</span>
                        </button>
                        <button className={styles.closeBtn} onClick={onClose}><X size={20} /></button>
                    </div>
                </header>

                <div className={styles.body}>
                    <div className={styles.viewToggle}>
                        <button
                            className={view === 'live' ? styles.activeTab : ''}
                            onClick={() => setView('live')}
                        >
                            EN VIVO
                        </button>
                        <button
                            className={view === 'history' ? styles.activeTab : ''}
                            onClick={() => setView('history')}
                        >
                            HISTORIAL SEÑALES
                        </button>
                    </div>

                    {view === 'live' ? (
                        <div className={styles.viewContent}>
                            <div className={sniperActive ? styles.statusBannerActive : styles.statusBannerIdle}>
                                <div className={styles.bannerInfo}>
                                    <Disc size={20} className={sniperActive ? styles.pulse : ''} />
                                    <div>
                                        <div className={styles.bannerTitle}>
                                            {sniperActive ? 'SISTEMA DE CAZA ACTIVO' : 'SISTEMA EN PAUSA'}
                                        </div>
                                        <p className={styles.bannerText}>
                                            {sniperActive
                                                ? 'Analizando bloques de Solana y ejecutando RugCheck...'
                                                : 'El bot detecta ballenas pero NO realizará compras.'}
                                        </p>
                                    </div>
                                </div>
                                {!sniperActive && (
                                    <button className={styles.activateQuickBtn} onClick={toggleSniper}>
                                        ACTIVAR AHORA
                                    </button>
                                )}
                            </div>

                            <div className={styles.bankrollConfig}>
                                <div className={styles.configItem}>
                                    <label>SALDO INICIAL (USD)</label>
                                    <div className={styles.inputWrap}>
                                        <input
                                            type="number"
                                            value={balance}
                                            onFocus={() => setIsEditing(true)}
                                            onChange={(e) => setBalance(parseFloat(e.target.value) || 0)}
                                            onBlur={() => {
                                                setIsEditing(false);
                                                updateConfig(balance, stakePercent, minWhaleSol);
                                            }}
                                        />
                                    </div>
                                </div>
                                <div className={styles.configItem}>
                                    <label>STAKE (%)</label>
                                    <div className={styles.inputWrap}>
                                        <input
                                            type="number"
                                            value={stakePercent}
                                            onFocus={() => setIsEditing(true)}
                                            onChange={(e) => setStakePercent(parseInt(e.target.value) || 0)}
                                            onBlur={() => {
                                                setIsEditing(false);
                                                updateConfig(balance, stakePercent, minWhaleSol);
                                            }}
                                        />
                                    </div>
                                </div>
                                <div className={styles.configItem}>
                                    <label>MIN WHALE (SOL)</label>
                                    <div className={styles.inputWrap}>
                                        <select
                                            className={styles.selectInput}
                                            value={minWhaleSol}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value);
                                                setMinWhaleSol(val);
                                                updateConfig(balance, stakePercent, val);
                                            }}
                                        >
                                            {[5, 10, 20, 30, 40, 50, 80, 100, 200, 500, 1000].map(v => (
                                                <option key={v} value={v}>{v} SOL</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className={styles.walletDisplay}>
                                <div className={styles.walletItem}>
                                    <div className={styles.walletLabel}>VIRTUAL WALLET</div>
                                    <div className={styles.walletBalance}>${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                </div>
                                <div className={styles.walletDivider} />
                                <div className={styles.walletItem}>
                                    <div className={styles.walletLabel}>DISPONIBLE</div>
                                    <div className={styles.availableBalance} style={{ color: availableBalance < (balance * 0.2) ? '#EF4444' : '#000' }}>
                                        ${availableBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                </div>
                            </div>

                            {activeTrades.length > 0 && (
                                <div className={styles.activeSection}>
                                    <div className={styles.sectionTitle}>🚀 TRADES EN CURSO (SNIPING)</div>
                                    <div className={styles.activeList}>
                                        {activeTrades.map(trade => (
                                            <div key={trade.id} className={styles.activeCard}>
                                                <div className={styles.activeTop}>
                                                    <span className={styles.activeWhale}>{trade.whale}</span>
                                                    <div className={styles.pnlLabel} style={{ color: parseFloat(trade.pnl) >= 0 ? '#14F195' : '#EF4444' }}>
                                                        {parseFloat(trade.pnl) >= 0 ? '+' : ''}{trade.pnl}%
                                                        <span className={styles.liveBadge}>LIVE</span>
                                                    </div>
                                                    <button
                                                        className={styles.manualCloseBtn}
                                                        onClick={() => closeTradeManually(trade.id)}
                                                    >
                                                        CERRAR
                                                    </button>
                                                </div>
                                                <div className={styles.activeAmtLine}>
                                                    Token: {trade.token?.substring(0, 10)}... | Stake: ${trade.stakeAmount.toFixed(2)}
                                                </div>
                                                <div className={styles.progressBar}>
                                                    <div
                                                        className={styles.progressFill}
                                                        style={{
                                                            width: `${Math.min(Math.abs(parseFloat(trade.pnl)) * 10, 100)}%`,
                                                            backgroundColor: parseFloat(trade.pnl) >= 0 ? '#14F195' : '#EF4444'
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className={styles.scanSection}>
                                <div className={styles.liveIndicator}>
                                    <Disc size={12} className={styles.pulse} /> ESCANEO DE BLOQUES (SOLANA)
                                </div>

                                {loading && whales.length === 0 ? (
                                    <div className={styles.loadingArea}>
                                        <RefreshCw className={styles.spin} size={40} color="#9945FF" />
                                        <p>Conectando al RPC de Solana...</p>
                                    </div>
                                ) : (
                                    <div className={styles.whaleList}>
                                        {whales.map((whale, idx) => (
                                            <div key={idx} className={styles.whaleCard}>
                                                <div className={styles.whaleMain}>
                                                    <TrendingUp size={20} color="#14F195" />
                                                    <div className={styles.whaleDetails}>
                                                        <span className={styles.walletAddr}>{whale.wallet.substring(0, 10)}...</span>
                                                        <span className={styles.timeTag}>{whale.time}</span>
                                                    </div>
                                                    <div className={styles.amountBox}>
                                                        <span className={styles.solAmt}>{whale.amount} SOL</span>
                                                        <span className={styles.usdAmt}>≈ ${whale.usd} USD</span>
                                                    </div>
                                                </div>
                                                <div className={styles.whaleFooter}>
                                                    <div className={styles.sigBox}>
                                                        <span className={styles.sigLink}>Sig: {whale.signature.substring(0, 8)}...</span>
                                                        <div className={styles.externalLinks}>
                                                            <a href={`https://dexscreener.com/search?q=${whale.wallet}`} target="_blank" rel="noreferrer" className={styles.dexBtn}>
                                                                DEX
                                                            </a>
                                                            <a href={`https://solscan.io/tx/${whale.signature}`} target="_blank" rel="noreferrer" className={styles.solscanBtn}>
                                                                SCAN
                                                            </a>
                                                        </div>
                                                    </div>
                                                    {parseFloat(whale.amount) >= minWhaleSol && (
                                                        <div className={styles.tagWrapper}>
                                                            <span className={styles.matchTag}>🚀 FILTRANDO</span>
                                                            {!sniperActive && <span className={styles.pausedHint}>Bot Off</span>}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className={styles.historySection}>
                            <div className={styles.historyHeader}>
                                <div className={styles.historyTitleBox}>
                                    <h3>RESUMEN DE OPERACIONES</h3>
                                    <div className={styles.netProfitLine}>
                                        Ganancia: <span style={{ color: totalProfitUSD >= 0 ? '#14F195' : '#EF4444' }}>
                                            {totalProfitUSD >= 0 ? '+' : ''}${totalProfitUSD.toFixed(2)}
                                        </span>
                                    </div>
                                </div>
                                <button className={styles.clearBtn} onClick={clearHistory}>
                                    <Trash2 size={16} /> REINICIAR
                                </button>
                            </div>

                            <div className={styles.historyStats}>
                                <div className={styles.statBox}>
                                    <span className={styles.statLabel}>WIN RATE</span>
                                    <span className={styles.statVal}>{winRate}%</span>
                                </div>
                                <div className={styles.statBox}>
                                    <span className={styles.statLabel}>TOTAL TRADES</span>
                                    <span className={styles.statVal}>{history.length}</span>
                                </div>
                            </div>

                            <div className={styles.historyList}>
                                {history.length === 0 ? (
                                    <div className={styles.emptyHistory}>Aún no hay trades cerrados.</div>
                                ) : (
                                    history.map((sig) => (
                                        <div key={sig.id} className={styles.historyCard}>
                                            <div className={styles.sigDetail}>
                                                <span className={styles.sigWhale}>{sig.whale}</span>
                                                <span className={styles.sigAmt}>{sig.amount}</span>
                                            </div>
                                            <div className={styles.sigResult}>
                                                <div className={sig.status === 'WIN' ? styles.profit : styles.loss}>
                                                    {sig.pnl} (${sig.profitUSD})
                                                </div>
                                                <span className={styles.sigTime}>{sig.time}</span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <footer className={styles.footer}>
                    <div className={styles.configNote}>
                        <AlertCircle size={14} />
                        <span>Filtro activo: &gt; {minWhaleSol} SOL + RugCheck &lt; 20000 (Ultra-Permisivo).</span>
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default WhaleSniperModal;
