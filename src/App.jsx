import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
// import ParticlesBackground from './components/ParticlesBackground';
import MobileNavbar from './components/MobileNavbar';
import styles from './App.module.css';
import { TOP_PAIRS as INITIAL_PAIRS, fetchTopPairs, fetchCandles, fetchTickerPrices, fetchDepth } from './api/binance';
import { analyzePair, analyzeFlow, analyzeBlitz, calculateForecast } from './utils/analysis';
import MarketGrid from './components/MarketGrid';
import SentinelCard from './components/SentinelCard';
import WalletCard from './components/WalletCard';

import DocumentationModal from './components/DocumentationModal';
import HistoryModal from './components/HistoryModal'; // Feature: Detailed History
import LogConsole from './components/LogConsole';
import { sendTelegramAlert } from './utils/telegram';
import { BookOpen, Terminal, ShieldCheck, History } from 'lucide-react'; // Added History Icon
import ActiveTradeCard from './components/ActiveTradeCard';
import BotReport from './components/BotReport';

function App() {
  const [pairs, setPairs] = useState(INITIAL_PAIRS); // Dynamic Top 10 Pairs
  const [marketData, setMarketData] = useState({});
  const [loading, setLoading] = useState(true);
  const isFetchingBus = useRef(false); // OPTIMIZATION: Request Lock


  // FORCE BLITZ MODE
  const [timeframe, setTimeframe] = useState('5m');
  const [activeStrategy, setActiveStrategy] = useState('BLITZ');
  const [tradingMode, setTradingMode] = useState('SIMULATION'); // Default safe
  const [walletConfig, setWalletConfig] = useState({}); // bot logic and risk settings

  const [isDocsOpen, setIsDocsOpen] = useState(false); // NEW: Documentation State
  const [isHistoryOpen, setIsHistoryOpen] = useState(false); // NEW: Detailed History State
  const [isLogOpen, setIsLogOpen] = useState(false); // NEW: Log Console State
  const [lockdown, setLockdown] = useState(false); // NEW: Emergency State
  const [apiConfigured, setApiConfigured] = useState(false); // NEW: API Check

  // --- CLOUD AUTONOMY STATE ---
  // Keep a Ref for the status to avoid stale closures in the Interval
  const cloudStatusRef = useRef({ active: [], history: [], blacklist: [] });
  const [cloudStatus, setCloudStatusState] = useState({ active: [], history: [] });

  // Wrapper to sync Ref and State
  const setCloudStatus = (newStatusOrFn) => {
    setCloudStatusState(prev => {
      const newVal = typeof newStatusOrFn === 'function' ? newStatusOrFn(prev) : newStatusOrFn;
      cloudStatusRef.current = { ...prev, ...newVal }; // Update Ref
      return newVal;
    });
  };

  // --- BINANCE REAL BALANCE ---
  const [binanceBalance, setBinanceBalance] = useState(null);

  const fetchBinanceBalance = async () => {
    try {
      const res = await fetch('/api/wallet/balance');
      if (res.ok) {
        const data = await res.json();
        setBinanceBalance(data);
      }
    } catch (e) {
      console.error("Balance fetch failed", e);
    }
  };

  useEffect(() => {
    fetchBinanceBalance();
    const interval = setInterval(fetchBinanceBalance, 20000); // Check every 20s
    return () => clearInterval(interval);
  }, []);

  // --- MOBILE NAV STATE ---
  const [mobileTab, setMobileTab] = useState('dashboard');

  const handleMobileNav = (tab) => {
    setMobileTab(tab);
    // DASHBOARD = MARKET GRID
    if (tab === 'dashboard') document.getElementById('market-section')?.scrollIntoView({ behavior: 'smooth' });
    // WALLET = TOP / WALLET CARD
    if (tab === 'wallet') window.scrollTo({ top: 0, behavior: 'smooth' });
    if (tab === 'settings') walletRef.current?.configure(); // Open config modal
  };

  // --- MODE & CONFIG SYNC ---
  const loadModeAndConfig = useCallback(async () => {
    try {
      // 1. Fetch Global Mode
      const modeRes = await fetch('/api/wallet/active-mode');
      const { mode } = modeRes.ok ? await modeRes.json() : { mode: 'SIMULATION' };
      setTradingMode(mode);

      // 2. Fetch Config for that mode
      const configRes = await fetch(`/api/wallet/config?mode=${mode}`);
      const data = configRes.ok ? await configRes.json() : null;

      if (data) {
        setWalletConfig(data);
        // SYNC: Ensure frontend activeStrategy matches database on startup
        if (data.strategy && data.strategy !== activeStrategy) {
          setActiveStrategy(data.strategy);
          localStorage.setItem('sentinel_strategy', data.strategy);
          if (data.strategy.includes('BLITZ') || data.strategy === 'SCALP') setTimeframe('5m');
          else if (data.strategy === 'TRIPLE') setTimeframe('15m');
        } else {
          if (data.strategy && data.strategy.includes('BLITZ') && timeframe !== '5m') setTimeframe('5m');
        }
      }
    } catch (err) {
      console.error('Failed to sync mode/config:', err);
    }
  }, [activeStrategy, timeframe]);

  useEffect(() => {
    loadModeAndConfig();
  }, []);

  const fetchCloudStatus = async (explicitMode = null) => {
    try {
      const modeToFetch = explicitMode || tradingMode;
      const res = await fetch(`/api/get-status?mode=${modeToFetch}`);
      if (res.ok) {
        const data = await res.json();
        setCloudStatus({
          active: data.active || [],
          history: data.history || [],
          blacklist: data.blacklist || [] // 💀 Sync Blacklist
        });
        setLockdown(data.lockdown || false); // Sync Lockdown
        setApiConfigured(data.isApiConfigured || false); // Sync API Status
      }
    } catch (err) {
      console.error('Cloud Status Sync Error:', err);
    }
  };

  const toggleTradingMode = async () => {
    try {
      const newMode = tradingMode === 'SIMULATION' ? 'LIVE' : 'SIMULATION';

      // ⚡ IMMEDIATE VISUAL FLUSH
      setLoading(true);
      setCloudStatus({ active: [], history: [], blacklist: [] }); // Clear UI immediately
      setTradingMode(newMode); // Optimistic UI update
      setWalletConfig({}); // Clear config to prevent mismatched data
      setMarketData({}); // Clear old prices to prevent ghosting

      const res = await fetch('/api/wallet/active-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode })
      });

      if (res.ok) {
        // Reload config for the new mode
        const configRes = await fetch(`/api/wallet/config?mode=${newMode}`);
        if (configRes.ok) {
          const configData = await configRes.json();
          setWalletConfig(configData);
        }

        // Reload Cloud Status (Trades/History) for the new mode
        await fetchCloudStatus(newMode);

        console.log(`🌓 Mode toggled to: ${newMode}`);
      }
      setLoading(false);
    } catch (e) {
      console.error("Toggle Mode Error:", e);
      setLoading(false);
    }
  };


  const toggleLockdown = async () => {
    if (!confirm(lockdown ? '¿Desbloquear sistema y permitir operaciones?' : '⛔ ¿PARADA DE EMERGENCIA?\n\nEsto bloqueará todas las nuevas operaciones.')) return;
    try {
      const res = await fetch('/api/lockdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !lockdown })
      });
      if (res.ok) {
        const data = await res.json();
        setLockdown(data.lockdown);
      }
    } catch (e) { console.error('Lockdown failed', e); }
  };

  // --- WALLET REF for mobile config ---
  const walletRef = useRef(null);

  const handleManualAction = async (action, data) => {
    try {
      const res = await fetch('/api/manual-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data })
      });
      if (res.ok) {
        const result = await res.json();
        setCloudStatus(prev => ({ ...prev, active: result.active }));
      }
    } catch (e) {
      console.error("Manual Action Error:", e);
    }
  };

  const handleSimulate = useCallback((symbol, price, type, amount = null) => {
    // [NEW] Capture ATR-based targets from analysis if available (BLITZ mode)
    let takeProfit = null;
    let stopLoss = null;

    if (activeStrategy.includes('BLITZ') && marketData[symbol]?.obZone) {
      takeProfit = marketData[symbol].obZone.tp;
      stopLoss = marketData[symbol].obZone.sl;
      console.log(`🚀 Capturing ATR Targets for ${symbol}: TP ${takeProfit}, SL ${stopLoss}`);
    }

    handleManualAction('OPEN', { symbol, price, type, strategy: activeStrategy, takeProfit, stopLoss, amount });
  }, [activeStrategy, marketData]);

  const handleCloseManual = useCallback((id) => {
    // Find the trade to get the symbol and current price
    const trade = cloudStatus.active.find(t => t.id === id);
    const currentPrice = trade ? marketData[trade.symbol]?.price : null;

    handleManualAction('CLOSE', { id, exitPrice: currentPrice, source: 'user' });
  }, [cloudStatus.active, marketData]);


  // WRAPPED IN USECALLBACK for Deps Safety
  const fetchData = useCallback(async (overrideTimeframe) => {
    if (isFetchingBus.current) return; // PREVENT OVERLAP
    isFetchingBus.current = true;

    const currentTf = overrideTimeframe || timeframe;
    const results = {};

    try {

      // 1. Fetch Market Context (Binance)
      // 0. Dynamic Pair Selection (Top Volume + Active Trades)
      let currentPairs = [...pairs];

      // ALWAYS Ensure Active Trades are in the fetch list (Use Ref for safety in interval)
      const cachedActive = cloudStatusRef.current.active || [];
      const activeSymbols = cachedActive.map(t => t.symbol);

      // Merge unique
      currentPairs = [...new Set([...currentPairs, ...activeSymbols])];

      if (loading) { // Only fetch new Top Market list on initial load
        try {
          const topPairs = await fetchTopPairs();
          // Update base pairs state
          setPairs(topPairs);
          // Update local for this cycle
          currentPairs = [...new Set([...topPairs, ...activeSymbols])];
        } catch (e) {
          console.warn("Using fallback pairs", e);
        }
      }

      // 1. Fetch Prices (Real-Time Ticker for speed)
      // [FIX] Use fetchTickerPrices instead of loop
      const pricesMap = await fetchTickerPrices(currentPairs);

      // 2. Fetch Candles (Simultaneously for all pairs)
      // [SYNC FIX] Force 150 candles to match Backend logic for proper Odds calculation
      const candlesMap = await fetchCandles(currentPairs, currentTf, 150);

      // 3. Process each pair
      for (const symbol of currentPairs) {
        // [FIX] Permissive Rendering: Don't skip if data is partial
        const klines = candlesMap[symbol] || [];
        let price = pricesMap[symbol];

        // Fallback Price
        if (!price && klines.length > 0) {
          price = klines[klines.length - 1].close;
        }

        // Run Analysis only if we have enough data
        let analysis = {};
        if (klines.length >= 20) {
          try {
            analysis = {
              ...analyzePair(klines),
              ...analyzeFlow(null, klines), // Flow indicators (Depth null for now)
              ...analyzeBlitz(null, klines), // BLITZ Signal (Depth null for now)
              forecast: calculateForecast(klines)
            };

            // Capture Raw Technical Signal (The "Dip")
            const rawSignal = analysis.prediction?.signal || 'NEUTRAL';
            analysis.indicators.isDip = rawSignal.includes('BUY'); // True if Dip Detected

            // 💀 CHECK BLACKLIST (Pain Memory)
            const isBlacklisted = (cloudStatusRef.current.blacklist || []).includes(symbol);
            analysis.indicators.isBlacklisted = isBlacklisted;

            // 🛡️ FRONTEND HYBRID FILTER: Match Backend Logic
            const useHybrid = walletConfig?.strategyConfig?.HYBRID_BLITZ?.useHybrid !== false; // Default ON
            const odds = parseFloat(analysis.indicators?.hybrid?.odds || 50);

            if (activeStrategy.includes('BLITZ') && useHybrid && odds < 67) {
              // Suppress Signal if Odds are too low
              if (analysis.prediction?.signal.includes('BUY')) {
                analysis.prediction.signal = 'NEUTRAL';
                analysis.prediction.label = `🛡️ PROTEGIDO (${odds.toFixed(0)}%)`;
                analysis.prediction.color = '#64748B'; // Gray out
              }
            }

            // 💀 PAIN MEMORY SUPPRESSION
            if (isBlacklisted && analysis.prediction?.signal.includes('BUY')) {
              analysis.prediction.signal = 'NEUTRAL';
              analysis.prediction.label = `🚫 BLOQUEADO`;
              analysis.prediction.color = '#EF4444';
            }
          } catch (err) {
            console.warn(`Analysis failed for ${symbol}:`, err);
          }
        }

        // ALWAYS push to results (Force UI Render)
        results[symbol] = {
          symbol,
          price: price || 0,
          ...analysis
        };
      }

      setMarketData(results);
      setLoading(false);

      // Status Sync (Trades)
      await fetchCloudStatus();

    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      isFetchingBus.current = false;
    }
  }, [pairs, timeframe, tradingMode, loading, walletConfig, activeStrategy]); // Added proper deps

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(), 4000); // 4s Loop
    return () => clearInterval(interval);
  }, [fetchData]); // Depends on the callback itself

  // Auto-Sync Strategy Mode
  const handleStrategyChange = (newStrategy) => {
    setActiveStrategy(newStrategy);
    localStorage.setItem('sentinel_strategy', newStrategy);
    if (newStrategy.includes('BLITZ') || newStrategy === 'SCALP') setTimeframe('5m');
    else if (newStrategy === 'TRIPLE') setTimeframe('15m');
    else setTimeframe('4h');

    // Trigger instant reload
    setTimeout(() => fetchData(newStrategy.includes('BLITZ') ? '5m' : '4h'), 100);
  };

  const handleConfigChange = (status, balance, config) => {
    // 1. Sync Active Trades & History (Real-time polling)
    if (status) {
      setCloudStatus(prev => ({
        active: status.active || [],
        history: status.history || []
      }));
    }

    // 2. Sync Binace Balance
    if (balance) {
      setBinanceBalance(balance);
    }

    // 3. Sync Wallet Config
    if (config) {
      setWalletConfig(config);

      if (config.strategy && config.strategy !== activeStrategy) {
        setActiveStrategy(config.strategy);
      }
      // Also sync trading mode if changed from wallet
      if (config.tradingMode && config.tradingMode !== tradingMode) {
        setTradingMode(config.tradingMode);
      }
    }
  };

  return (
    <div className={styles.appContainer}>
      {/* <ParticlesBackground /> */}
      <MobileNavbar activeTab={mobileTab} onTabChange={handleMobileNav} />

      <main className={styles.mainContent}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.logo} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={26} color="#00D9FF" strokeWidth={2.5} />
              <span>SENTINEL <span style={{ color: '#00D9FF' }}>AI</span></span>
            </div>
            <div
              className={styles.statusBadge}
              onClick={toggleTradingMode}
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
              marginRight: '15px',
              display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '0.65rem', fontWeight: 'bold',
              color: apiConfigured ? '#10B981' : '#64748B',
              border: apiConfigured ? '1px solid rgba(16, 185, 129, 0.2)' : '1px dashed #64748B',
              padding: '4px 8px', borderRadius: '4px',
              background: apiConfigured ? 'rgba(16, 185, 129, 0.05)' : 'transparent'
            }} title={apiConfigured ? "Conectado a Binance" : "Sin API Key Configurada"}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: apiConfigured ? '#10B981' : '#64748B', boxShadow: apiConfigured ? '0 0 5px #10B981' : 'none' }}></div>
              {apiConfigured ? 'API: LIVE' : 'NO API'}
            </div>

            {/* EMERGENCY BUTTON */}
            <button
              onClick={toggleLockdown}
              style={{
                background: lockdown ? '#EF4444' : 'rgba(239, 68, 68, 0.1)',
                border: '1px solid #EF4444',
                color: lockdown ? '#fff' : '#EF4444',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px',
                marginRight: '10px',
                boxShadow: lockdown ? '0 0 15px rgba(239, 68, 68, 0.5)' : 'none',
                animation: lockdown ? 'pulse 2s infinite' : 'none'
              }}
            >
              {lockdown ? '⛔ SISTEMA BLOQUEADO' : '🛑 STOP'}
            </button>

            <button
              onClick={() => setIsLogOpen(true)}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#94A3B8',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px',
                marginRight: '15px'
              }}
            >
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
            onUpdate={loadModeAndConfig}
            activeTrades={cloudStatus.active}
            marketData={marketData}
            activeStrategy={activeStrategy}
            tradingMode={tradingMode}
            onToggleMode={toggleTradingMode}
          />

          <BotReport
            config={walletConfig}
            cloudStatus={cloudStatus}
          />
        </section>

        {/* --- Active Trades Section --- */}
        <section className={styles.portfolioSection}>
          {
            cloudStatus.active.length > 0 && (
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
                    />
                  ))}
                </div>
              </>
            )
          }

          {/* Fallback Message */}
          {cloudStatus.active.length === 0 && (
            <div style={{
              textAlign: 'center',
              padding: '40px',
              border: '1px dashed rgba(255,255,255,0.1)',
              borderRadius: '12px',
              color: '#64748B',
              marginBottom: '30px'
            }}>
              <div>🌑 SISTEMA EN ESCANEO (IDLE)</div>
              <div style={{ fontSize: '0.8rem', marginTop: '5px' }}>Esperando señales de alta probabilidad...</div>
            </div>
          )
          }
        </section >

        {/* --- Historial de Victorias NUBE --- */}
        {
          cloudStatus.history.length > 0 && (
            <section className={styles.portfolioSection} style={{ marginTop: '-20px', marginBottom: '40px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h2 className={styles.sectionTitle} style={{ color: '#10B981', opacity: 1, margin: 0 }}>🏆 HISTORIAL DE OPERACIONES</h2>
                <button
                  onClick={async () => {
                    if (confirm('¿Borrar todo el historial de victorias?')) {
                      try {
                        await fetch('/api/manual-trade', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'CLEAR_HISTORY' })
                        });
                        setCloudStatus(prev => ({ ...prev, history: [] }));
                      } catch (e) {
                        alert('Error al borrar historial');
                      }
                    }
                  }}
                  style={{
                    background: 'rgba(239, 68, 68, 0.1)',
                    color: '#EF4444',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '0.7rem'
                  }}
                >
                  🗑️ BORRAR HISTORIAL
                </button>

                <button
                  onClick={() => setIsHistoryOpen(true)}
                  style={{
                    background: 'rgba(59, 130, 246, 0.1)', border: '1px solid #3B82F6', color: '#60A5FA',
                    padding: '6px 12px', borderRadius: '6px', fontSize: '0.7rem', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '6px'
                  }}
                >
                  <History size={14} />
                  DETALLADO
                </button>
              </div>
              <div className={styles.tradeGrid}>
                {cloudStatus.history.map((h, i) => {
                  const isWin = h.pnl >= 0;
                  const statusColor = isWin ? '#10B981' : '#EF4444';
                  const bgStyle = isWin ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)';
                  const borderStyle = isWin ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)';

                  return (
                    <div key={i} className={styles.tradeCard} style={{
                      border: borderStyle,
                      background: bgStyle,
                      padding: '12px'
                    }}>
                      {/* Header: Status, Type, Strategy, Pair */}
                      <div className={styles.tradeCardHeader} style={{ marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className={styles.tradeTag} style={{ background: statusColor, color: '#fff', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem' }}>
                            {isWin ? 'WIN' : 'LOSS'}
                          </span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: statusColor }}>{h.type}</span>
                          <span style={{ fontSize: '0.7rem', color: '#64748B' }}>{h.strategy || 'MANUAL'}</span>

                          {/* Duration Display */}
                          {h.entryTimestamp && (
                            <span style={{ fontSize: '0.7rem', color: '#10B981', fontWeight: 'bold', marginLeft: '4px' }}>
                              ⏱️ {(() => {
                                const start = new Date(h.entryTimestamp);
                                const end = new Date(h.timestamp);
                                if (isNaN(start.getTime()) || isNaN(end.getTime())) return "--";

                                const diff = end - start;
                                const hr = Math.floor(diff / 3600000);
                                const mn = Math.floor((diff % 3600000) / 60000);
                                const sc = Math.floor((diff % 60000) / 1000);
                                if (hr > 0) return `${hr}h ${mn}m`;
                                if (mn > 0) return `${mn}m ${sc}s`;
                                return `${sc}s`;
                              })()}
                            </span>
                          )}
                        </div>
                        <span className={styles.tradeSymbol} style={{ fontSize: '0.9rem' }}>{h.symbol.replace('USDT', '')}</span>
                      </div>

                      {/* Prices Grid */}
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '10px',
                        background: 'rgba(0, 0, 0, 0.2)',
                        padding: '8px',
                        borderRadius: '6px',
                        marginBottom: '10px'
                      }}>
                        <div>
                          <div style={{ fontSize: '0.65rem', color: '#94A3B8', marginBottom: '2px' }}><span>ENTRADA DE</span></div>
                          <div style={{ fontSize: '0.85rem', fontFamily: 'monospace', color: '#E2E8F0' }}>
                            ${h.entryPrice ? h.entryPrice.toLocaleString() : '---'}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.65rem', color: '#94A3B8', marginBottom: '2px' }}><span>SALIDA EN</span></div>
                          <div style={{ fontSize: '0.85rem', fontFamily: 'monospace', color: statusColor, fontWeight: 'bold' }}>
                            ${(h.exitPrice || h.closePrice) ? (h.exitPrice || h.closePrice).toLocaleString() : '---'}
                          </div>
                        </div>
                      </div>

                      {/* Results Footer */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontSize: '0.7rem', color: '#94A3B8' }}><span>Resultado Neto</span></span>
                          <span style={{ color: statusColor, fontWeight: 'bold', fontSize: '1rem' }}>
                            {isWin ? '+' : ''}{h.pnl.toFixed(2)}%
                          </span>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}><span>Valor Final 💵</span></div>
                          <div style={{ color: '#fff', fontWeight: 'bold', fontFamily: 'monospace', fontSize: '1rem' }}>
                            ${(h.investedAmount + (h.profitUsd || h.netProfit || 0)).toFixed(2)}
                          </div>
                          <div style={{ fontSize: '0.65rem', color: statusColor }}>
                            ({(h.profitUsd || h.netProfit) >= 0 ? '+' : ''}${(h.profitUsd || h.netProfit || 0).toFixed(2)})
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )
        }

        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <button
            onClick={() => sendTelegramAlert('TEST-CLOUD', 0, { label: 'TEST DESDE WEB', color: '#fff' })}
            style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#848E9C', padding: '6px 12px', borderRadius: '6px', fontSize: '0.7rem', cursor: 'pointer' }}
          >
            PROBAR TELEGRAM
          </button>
        </div>

        {/* --- MARKET ANALYSIS GRID --- */}
        {activeStrategy !== 'SNIPER' && (
          <section id="market-section" style={{ width: '100%', marginTop: '20px' }}>
            <h2 className={styles.sectionTitle}>📊 ANÁLISIS DE MERCADO (TOP 10 VOLUMEN)</h2>

            {Object.keys(marketData).length === 0 && (
              <div style={{ padding: '30px', textAlign: 'center', color: '#94A3B8', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '8px', background: 'rgba(0,0,0,0.2)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '10px' }}>📡</div>
                <p style={{ fontWeight: 'bold' }}>Esperando Datos de Mercado...</p>
                <div style={{ fontSize: '0.75rem', marginTop: '10px', color: '#64748B' }}>
                  PARES: {pairs.length} | ESTRATEGIA: {activeStrategy}<br />
                  INTENTANDO CONECTAR CON BINANCE...
                </div>
              </div>
            )}

            <MarketGrid>
              {Object.keys(marketData).map(symbol => {
                const minOdds = walletConfig?.strategyConfig?.HYBRID_BLITZ?.minOdds || 67;
                return (
                  <SentinelCard
                    key={symbol}
                    symbol={symbol}
                    data={marketData[symbol]}
                    loading={loading}
                    onSimulate={handleSimulate}
                    minOdds={minOdds}
                  />
                );
              })}
            </MarketGrid>
          </section>
        )}




        <footer className={styles.footer}>
          <div className={styles.copyright}>
            <span>© 2026 Binance Sentinel AI • Todos los derechos reservados</span>
            <span style={{ marginLeft: '15px', color: '#EF4444', opacity: 0.8 }}>
              <span>⚠️ El trading conlleva riesgos. No arriesgues lo que no puedas perder.</span>
            </span>
          </div>
          <div className={styles.docsLink} onClick={() => setIsDocsOpen(true)}>
            <BookOpen size={16} />
            Documentación
          </div>
        </footer>
      </main>

      <DocumentationModal isOpen={isDocsOpen} onClose={() => setIsDocsOpen(false)} />
      <HistoryModal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} mode={tradingMode} />
      {isLogOpen && <LogConsole onClose={() => setIsLogOpen(false)} />}

      <MobileNavbar activeTab={mobileTab} onTabChange={handleMobileNav} />
    </div>
  );
}

export default App;
