
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
import VESArbitrageModal from './components/VESArbitrageModal';
import LogConsole from './components/LogConsole';

import { BookOpen, Terminal, ShieldCheck, History, Globe } from 'lucide-react';

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
  const [isArbitrageOpen, setIsArbitrageOpen] = useState(false);
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

    // Capture ATR targets if available (VORTEX mode)
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
            <div className={styles.logo}>
              <ShieldCheck size={20} color="#00D9FF" strokeWidth={2.5} />
              <span>SENTINEL <span style={{ color: '#00D9FF' }}>AI</span></span>
            </div>

            {/* --- MONITOR VES BUTTON --- */}
            <button
              onClick={() => setIsArbitrageOpen(true)}
              style={{
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                color: '#60A5FA',
                padding: '4px 8px',
                borderRadius: '8px',
                fontSize: '0.6rem',
                fontWeight: '800',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.2s'
              }}
            >
              <Globe size={11} /> MONITOR VES
            </button>

            <div
              className={styles.statusBadge}
              onClick={onScanToggleMode}
              style={{ cursor: 'pointer', userSelect: 'none', marginLeft: 'auto' }}
            >
              <span className={styles.statusDot} style={{ background: tradingMode === 'LIVE' ? '#EF4444' : '#10B981' }}></span>
              {tradingMode}
            </div>
          </div>
          <div className={styles.headerRight}>

            {/* API STATUS */}
            <div style={{
              marginRight: '15px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.65rem', fontWeight: 'bold',
              color: apiConfigured ? '#10B981' : '#64748B',
              border: `1px solid ${apiConfigured ? 'rgba(16, 185, 129, 0.3)' : 'rgba(100, 116, 139, 0.2)'}`,
              padding: '6px 12px', borderRadius: '10px',
              background: 'rgba(255, 255, 255, 0.03)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)'
            }} title={apiConfigured ? "Conectado a Binance" : "Sin API Key Configurada"}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: apiConfigured ? '#10B981' : '#64748B',
                boxShadow: apiConfigured ? '0 0 10px #10B981' : 'none'
              }}></div>
              {apiConfigured ? 'API: LIVE' : 'NO API'}
            </div>

            {/* EMERGENCY BUTTON (HIDDEN IN READ ONLY) */}
            {!isReadOnly && (
              <button onClick={toggleLockdown} style={{
                background: lockdown ? '#EF4444' : 'rgba(239, 68, 68, 0.08)',
                border: '1px solid #EF4444',
                color: lockdown ? '#fff' : '#EF4444',
                padding: '8px 16px', borderRadius: '10px',
                fontSize: '0.7rem', fontWeight: 'bold',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                marginRight: '10px',
                boxShadow: lockdown ? '0 0 20px rgba(239, 68, 68, 0.6)' : 'none',
                animation: lockdown ? 'pulse 2s infinite' : 'none',
                backdropFilter: 'blur(10px)'
              }}>
                {lockdown ? '⛔ BLOQUEADO' : '🛑 STOP'}
              </button>
            )}

            <button onClick={() => setIsLogOpen(true)} style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#94A3B8',
              padding: '8px 16px', borderRadius: '10px',
              fontSize: '0.75rem', fontWeight: 'bold',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
              marginRight: '15px',
              backdropFilter: 'blur(10px)'
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
            onConfigChange={setWalletConfig}
            activeTrades={cloudStatus.active}
            marketData={marketData}
            activeStrategy={activeStrategy}
            tradingMode={tradingMode}
            onToggleMode={onScanToggleMode}
            readOnly={isReadOnly}
            btcChange={btcChange}
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
                const stratConfig = walletConfig?.strategyConfig?.HYBRID_VORTEX || {};
                const minOdds = stratConfig.minOdds || 67;
                const showDip = stratConfig.useVortex !== false; // Default ON
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
        activeTrades={cloudStatus.active}
        marketData={marketData}
      />
      {isLogOpen && <LogConsole onClose={() => setIsLogOpen(false)} />}
      <VESArbitrageModal isOpen={isArbitrageOpen} onClose={() => setIsArbitrageOpen(false)} />
      <MobileNavbar activeTab={mobileTab} onTabChange={handleMobileNav} />
    </div>
  );
}

export default App;
