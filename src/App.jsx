
import React, { useState, useRef, useCallback } from 'react';
import styles from './App.module.css';

// --- COMPONENTS ---
import MobileNavbar from './components/MobileNavbar';
import MarketGrid from './components/MarketGrid';
import SentinelCard from './components/SentinelCard';
import WalletCard from './components/WalletCard';
import ActiveTradeCard from './components/ActiveTradeCard';
import BotReport from './components/BotReport';
import DocumentationModal from './components/DocumentationModal';
import HistoryModal from './components/HistoryModal';
import LogConsole from './components/LogConsole';
import { BookOpen, Terminal, ShieldCheck, History } from 'lucide-react';

// --- HOOKS (The New Brains) ---
import { useWallet } from './hooks/useWallet';
import { useMarketData } from './hooks/useMarketData';
import { isVercelGuest } from './config/api';

function App() {
  // 1. Initialize Wallet (User State)
  const {
    tradingMode, activeStrategy, timeframe, walletConfig, cloudStatus,
    lockdown, apiConfigured, btcChange, binanceBalance,
    setWalletConfig, toggleTradingMode, toggleLockdown, handleManualAction, refreshConfig
  } = useWallet();

  // 2. Initialize Market Data (Data Feed)
  // We pass wallet data so the market hook knows which pairs to prioritize or filter
  const { marketData, loading, pairs, flushData } = useMarketData(
    activeStrategy, timeframe, tradingMode, walletConfig, cloudStatus
  );

  // --- UI STATE ---
  const [isDocsOpen, setIsDocsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState('dashboard');
  const walletRef = useRef(null);
  // --- GUEST MODE DETECTION ---
  const isReadOnly = (new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('view') === 'guest') || isVercelGuest();

  // --- HANDLERS ---
  const handleMobileNav = (tab) => {
    setMobileTab(tab);
    if (tab === 'dashboard') document.getElementById('market-section')?.scrollIntoView({ behavior: 'smooth' });
    if (tab === 'wallet') window.scrollTo({ top: 0, behavior: 'smooth' });
    // Prevent Settings access in ReadOnly
    if (tab === 'settings' && !isReadOnly) walletRef.current?.configure();
  };

  const onScanToggleMode = () => {
    toggleTradingMode(flushData); // Pass flush callback to wallet
  };

  const handleSimulate = useCallback((symbol, price, type, amount = null) => {
    if (isReadOnly) return; // Block in Guest Mode

    // Capture ATR targets if available (BLITZ mode)
    let takeProfit = null;
    let stopLoss = null;

    if (activeStrategy.includes('VORTEX') && marketData[symbol]?.obZone) {
      takeProfit = marketData[symbol].obZone.tp;
      stopLoss = marketData[symbol].obZone.sl;
      console.log(`🚀 Capturing ATR Targets for ${symbol}: TP ${takeProfit}, SL ${stopLoss}`);
    }

    handleManualAction('OPEN', { symbol, price, type, strategy: activeStrategy, takeProfit, stopLoss, amount });
  }, [activeStrategy, marketData, handleManualAction, isReadOnly]);

  const handleCloseManual = useCallback((id) => {
    if (isReadOnly) return; // Block in Guest Mode
    const trade = cloudStatus.active.find(t => t.id === id);
    const currentPrice = trade ? marketData[trade.symbol]?.price : null;
    handleManualAction('CLOSE', { id, exitPrice: currentPrice, source: 'user' });
  }, [cloudStatus.active, marketData, handleManualAction, isReadOnly]);


  return (
    <div className={styles.appContainer}>
      <MobileNavbar activeTab={mobileTab} onTabChange={handleMobileNav} />

      <main className={styles.mainContent}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.logo} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={26} color="#00D9FF" strokeWidth={2.5} />
              <span>SENTINEL <span style={{ color: '#00D9FF' }}>AI</span> {isReadOnly && <span style={{ fontSize: '0.6rem', background: '#333', padding: '2px 4px', borderRadius: '4px', color: '#aaa' }}>VIEWER</span>}</span>
            </div>
            <div
              className={styles.statusBadge}
              onClick={onScanToggleMode}
              style={{ cursor: 'pointer', userSelect: 'none' }}
              title="Click to Switch Mode (Live/Sim)"
            >
              <span className={styles.statusDot} style={{ background: tradingMode === 'LIVE' ? '#EF4444' : '#10B981', boxShadow: tradingMode === 'LIVE' ? '0 0 10px #EF4444' : '0 0 10px #10B981' }}></span>
              {tradingMode} MODE
            </div>
          </div>
          <div className={styles.headerRight}>

            {/* API STATUS */}
            <div style={{
              marginRight: '15px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.65rem', fontWeight: 'bold',
              color: apiConfigured ? '#10B981' : '#64748B', border: apiConfigured ? '1px solid rgba(16, 185, 129, 0.2)' : '1px dashed #64748B',
              padding: '4px 8px', borderRadius: '4px', background: apiConfigured ? 'rgba(16, 185, 129, 0.05)' : 'transparent'
            }} title={apiConfigured ? "Conectado a Binance" : "Sin API Key Configurada"}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: apiConfigured ? '#10B981' : '#64748B', boxShadow: apiConfigured ? '0 0 5px #10B981' : 'none' }}></div>
              {apiConfigured ? 'API: LIVE' : 'NO API'}
            </div>

            {/* EMERGENCY BUTTON (HIDDEN IN READ ONLY) */}
            {!isReadOnly && (
              <button onClick={toggleLockdown} style={{
                background: lockdown ? '#EF4444' : 'rgba(239, 68, 68, 0.1)', border: '1px solid #EF4444', color: lockdown ? '#fff' : '#EF4444',
                padding: '6px 12px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                marginRight: '10px', boxShadow: lockdown ? '0 0 15px rgba(239, 68, 68, 0.5)' : 'none', animation: lockdown ? 'pulse 2s infinite' : 'none'
              }}>
                {lockdown ? '⛔ BLOQUEADO' : '🛑 STOP'}
              </button>
            )}

            <button onClick={() => setIsLogOpen(true)} style={{
              background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94A3B8',
              padding: '6px 12px', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', marginRight: '15px'
            }}>
              <Terminal size={14} /> LOG
            </button>
            <div className={styles.clock}>{new Date().toLocaleTimeString()} UTC</div>
          </div>
        </header>

        <section id="wallet-section" className={styles.dashboardGrid}>
          {/* Wallet Card - Control Center */}
          <WalletCard
            ref={walletRef}
            mode={tradingMode}
            config={walletConfig}
            binanceBalance={binanceBalance}
            onUpdate={refreshConfig} // Use hook refresher
            activeTrades={cloudStatus.active}
            marketData={marketData}
            activeStrategy={activeStrategy}
            tradingMode={tradingMode}
            onToggleMode={onScanToggleMode}
            readOnly={isReadOnly}
            btcChange={btcChange} // NEW
          />

          <BotReport config={walletConfig} cloudStatus={cloudStatus} />
        </section>

        {/* --- Active Trades Section --- */}
        <section className={styles.portfolioSection}>
          {cloudStatus.active.length > 0 ? (
            <>
              <h2 className={styles.sectionTitle}>🚀 OPERACIONES ACTIVAS ({cloudStatus.active.length})</h2>
              <div className={styles.tradeGrid}>
                {cloudStatus.active.map((trade) => (
                  <ActiveTradeCard
                    key={trade.id}
                    trade={trade}
                    currentPrice={marketData[trade.symbol]?.price || trade.entryPrice}
                    walletConfig={walletConfig}
                    onClose={() => handleCloseManual(trade.id)}
                    readOnly={isReadOnly}
                  />
                ))}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '12px', color: '#64748B', marginBottom: '30px' }}>
              <div>🌑 SISTEMA EN ESCANEO (IDLE)</div>
              <div style={{ fontSize: '0.8rem', marginTop: '5px' }}>Esperando señales de alta probabilidad...</div>
            </div>
          )}
        </section >

        {/* --- Historial de Victorias NUBE --- */}
        {cloudStatus.history.length > 0 && (
          <section className={styles.portfolioSection} style={{ marginTop: '-20px', marginBottom: '40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h2 className={styles.sectionTitle} style={{ color: '#10B981', opacity: 1, margin: 0 }}>🏆 HISTORIAL DE OPERACIONES</h2>
              {/* <button onClick={async () => { ... }} style={{ ... }}>🗑️ BORRAR HISTORIAL</button> (Simplified for brevity, can restore action if needed) */}
              <div style={{ display: 'flex', gap: '8px' }}>
                {!isReadOnly && (
                  <button
                    onClick={() => {
                      if (window.confirm('¿Borrar historial?')) handleManualAction('CLEAR_HISTORY', {});
                    }}
                    style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px dashed #EF4444', color: '#EF4444', padding: '6px 12px', borderRadius: '6px', fontSize: '0.7rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    🗑️
                  </button>
                )}
                <button
                  onClick={() => setIsHistoryOpen(true)}
                  style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid #3B82F6', color: '#60A5FA', padding: '6px 12px', borderRadius: '6px', fontSize: '0.7rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <History size={14} /> DETALLADO
                </button>
              </div>
            </div>
            {/* Short History Grid (Visual Only) */}
            <div className={styles.tradeGrid}>
              {cloudStatus.history.slice(0, 4).map((h, i) => { // Show only last 4 here
                const isWin = h.pnl >= 0;
                const statusColor = isWin ? '#10B981' : '#EF4444';
                return (
                  <div key={i} className={styles.tradeCard} style={{ border: isWin ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)', background: isWin ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)', padding: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#fff', fontWeight: 'bold' }}>{h.symbol}</span>
                      <span style={{ color: statusColor, fontWeight: 'bold' }}>{h.pnl.toFixed(2)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          {!isReadOnly && (
            <button onClick={() => sendTelegramAlert('TEST-CLOUD', 0, { label: 'TEST WEB', color: '#fff' })} style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#848E9C', padding: '6px 12px', borderRadius: '6px', fontSize: '0.7rem', cursor: 'pointer' }}>
              PROBAR TELEGRAM
            </button>
          )}
        </div>

        {/* --- MARKET ANALYSIS GRID --- */}
        {activeStrategy !== 'SNIPER' && (
          <section id="market-section" style={{ width: '100%', marginTop: '20px' }}>
            <h2 className={styles.sectionTitle}>📊 ANÁLISIS DE MERCADO (TOP 10 VOLUMEN)</h2>
            {/* Show error/loading state from hook */}
            {Object.keys(marketData).length === 0 && (
              <div style={{ padding: '30px', textAlign: 'center', color: '#94A3B8', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '8px', background: 'rgba(0,0,0,0.2)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '10px' }}>📡</div>
                <p style={{ fontWeight: 'bold' }}>Esperando Datos de Mercado...</p>
                <div style={{ fontSize: '0.75rem', marginTop: '10px', color: '#64748B' }}>PARES: {pairs.length} | ESTRATEGIA: {activeStrategy}<br />INTENTANDO CONECTAR...</div>
              </div>
            )}

            <MarketGrid>
              {Object.keys(marketData).map(symbol => {
                const stratConfig = walletConfig?.strategyConfig?.HYBRID_BLITZ || {};
                const minOdds = stratConfig.minOdds || 67;
                const showDip = stratConfig.useBlitz !== false; // Default ON
                const showProb = stratConfig.useHybrid !== false; // Default ON

                return (
                  <SentinelCard
                    key={symbol}
                    symbol={symbol}
                    data={marketData[symbol]}
                    loading={loading}
                    onSimulate={handleSimulate}
                    minOdds={minOdds}
                    showDip={showDip}
                    showProb={showProb}
                    readOnly={isReadOnly}
                  />
                );
              })}
            </MarketGrid>
          </section>
        )}

        <footer className={styles.footer}>
          <div className={styles.copyright}>
            <span>© 2026 Binance Sentinel AI • Todos los derechos reservados</span>
            <span style={{ marginLeft: '15px', color: '#EF4444', opacity: 0.8 }}><span>⚠️ El trading conlleva riesgos.</span></span>
          </div>
          <div className={styles.docsLink} onClick={() => setIsDocsOpen(true)}>
            <BookOpen size={16} /> Documentación
          </div>
        </footer>
      </main>

      <DocumentationModal isOpen={isDocsOpen} onClose={() => setIsDocsOpen(false)} />
      {/* HistoryModal component definition moved inline */}
      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        mode={tradingMode}
        binanceBalance={binanceBalance}
        walletConfig={walletConfig}
      />
      {isLogOpen && <LogConsole onClose={() => setIsLogOpen(false)} />}
      <MobileNavbar activeTab={mobileTab} onTabChange={handleMobileNav} />
    </div>
  );
}

const HistoryModal = ({ isOpen, onClose, mode, binanceBalance, walletConfig }) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  // 📅 FILTER STATE (MT5 Style)
  const [filter, setFilter] = useState('ALL'); // ALL, TODAY, YESTERDAY, WEEK, MONTH, CUSTOM
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Derived Filtered Data
  const filteredHistory = useMemo(() => {
    if (!history || history.length === 0) return [];

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    return history.filter(t => {
      const tTime = new Date(t.timestamp).getTime();

      switch (filter) {
        case 'TODAY':
          return tTime >= todayStart;
        case 'YESTERDAY':
          return tTime >= (todayStart - 86400000) && tTime < todayStart;
        case 'WEEK':
          // Start of the current week (Sunday)
          const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).getTime();
          return tTime >= weekStart;
        case 'MONTH':
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
          return tTime >= monthStart;
        case 'CUSTOM':
          if (!customStart) return true;
          const start = new Date(customStart).getTime();
          // Add 23 hours, 59 minutes, 59 seconds to customEnd to include the whole day
          const end = customEnd ? new Date(customEnd).getTime() + 86399999 : Infinity;
          return tTime >= start && tTime <= end;
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

          {/* NEW: SUMMARY HEADER WITH REAL CAPITAL */}
          {!loading && filteredHistory.length > 0 && (() => {
            const totalUsd = filteredHistory.reduce((acc, t) => acc + (parseFloat(t.profitUsd) || 0), 0);
            const isLive = mode === 'LIVE';
            // Realismo: Prioritize Binance Balance if Live, else Wallet simulation current balance
            const accountCapital = isLive ? (binanceBalance?.total || 100) : (walletConfig?.currentBalance || 1000);
            const roeTotal = (totalUsd / accountCapital) * 100;

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
                  <div style={{ fontSize: '0.8rem', color: '#A7F3D0', fontWeight: 'bold', marginBottom: '4px' }}>ROE (Balance Actual)</div>
                  <div style={{ fontSize: '1.4rem', color: roeTotal >= 0 ? '#10B981' : '#EF4444', fontWeight: 'bold' }}>
                    {roeTotal >= 0 ? '+' : ''}{roeTotal.toFixed(2)}%
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
                {filteredHistory.map((trade, idx) => {
                  const pnlPct = trade.pnl || 0;
                  const profit = trade.profitUsd || 0;
                  const invested = pnlPct !== 0 ? (Math.abs(profit) / (Math.abs(pnlPct) / 100)) : 0;

                  return (
                    <div key={idx} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '15px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px',
                      borderLeft: `4px solid ${profit >= 0 ? '#10B981' : '#EF4444'}`
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                        {/* TOP ROW: Main Info */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#fff' }}>
                              {trade.symbol.replace('USDT', '')}
                            </div>
                            <div style={{
                              fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px',
                              background: 'rgba(255,255,255,0.1)', color: '#ccc', fontWeight: 'bold'
                            }}>
                              {trade.strategy || 'MANUAL'}
                            </div>

                            {/* CLOSE TYPE BADGE (NEW) */}
                            <div style={{
                              fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px',
                              background: trade.exitReason?.includes('MANUAL') ? 'rgba(59, 130, 246, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                              color: trade.exitReason?.includes('MANUAL') ? '#60A5FA' : '#FBBF24',
                              border: `1px solid ${trade.exitReason?.includes('MANUAL') ? '#3B82F6' : '#F59E0B'}`,
                              fontWeight: 'bold'
                            }}>
                              {trade.exitReason?.includes('MANUAL') ? 'MANUAL' : 'AUTO'}
                            </div>

                            {/* INVESTED CAPITAL PILL (NEW) */}
                            <div style={{
                              fontSize: '0.65rem', padding: '2px 8px', borderRadius: '4px',
                              background: 'rgba(0, 217, 255, 0.1)', color: '#00D9FF', border: '1px solid rgba(0, 217, 255, 0.3)',
                              fontWeight: 'bold'
                            }}>
                              INVERTIDO: ${invested.toFixed(2)}
                            </div>

                            {/* DURATION PILL (New Location) */}
                            {trade.entryTimestamp && (
                              <div style={{
                                fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px',
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
                              color: profit >= 0 ? '#10B981' : '#EF4444'
                            }}>
                              {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: pnlPct >= 0 ? '#A7F3D0' : '#FECACA', fontWeight: 'bold' }}>
                              {pnlPct.toFixed(2)}%
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
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
