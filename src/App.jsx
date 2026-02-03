import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
// import ParticlesBackground from './components/ParticlesBackground';
import MobileNavbar from './components/MobileNavbar';
import styles from './App.module.css';
import { TOP_PAIRS as INITIAL_PAIRS, fetchTopPairs, fetchCandles, fetchTickerPrices, fetchDepth } from './api/binance';
import { analyzePair, analyzeFlow, analyzeTriple, analyzeOB, analyzeHybrid, calculateForecast } from './utils/analysis';
import MarketGrid from './components/MarketGrid';
import SentinelCard from './components/SentinelCard';
import WalletCard from './components/WalletCard';

import DocumentationModal from './components/DocumentationModal'; // NEW: Docs
import { sendTelegramAlert } from './utils/telegram';
import { BookOpen } from 'lucide-react';
import ActiveTradeCard from './components/ActiveTradeCard';

function App() {
  const [pairs, setPairs] = useState(INITIAL_PAIRS); // Dynamic Top 10 Pairs
  const [marketData, setMarketData] = useState({});
  const [loading, setLoading] = useState(true);
  const isFetchingBus = useRef(false); // OPTIMIZATION: Request Lock


  const [timeframe, setTimeframe] = useState(() => {
    const s = localStorage.getItem('sentinel_strategy') || 'SWING';
    if (s.includes('BLITZ') || s === 'SCALP') return '5m';
    if (s === 'TRIPLE') return '15m';
    return '4h';
  });
  const [activeStrategy, setActiveStrategy] = useState(() => localStorage.getItem('sentinel_strategy') || 'SWING');
  const [tradingMode, setTradingMode] = useState('SIMULATION'); // Default safe
  const [walletConfig, setWalletConfig] = useState({}); // bot logic and risk settings

  const [isDocsOpen, setIsDocsOpen] = useState(false); // NEW: Documentation State

  // --- CLOUD AUTONOMY STATE ---
  const [cloudStatus, setCloudStatus] = useState({ active: [], history: [] });

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
    if (tab === 'dashboard') window.scrollTo({ top: 0, behavior: 'smooth' });
    if (tab === 'wallet') document.getElementById('wallet-section')?.scrollIntoView({ behavior: 'smooth' });
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
        setCloudStatus({ active: data.active || [], history: data.history || [] });
      }
    } catch (err) {
      console.error('Cloud Status Sync Error:', err);
    }
  };

  const toggleTradingMode = async () => {
    try {
      const newMode = tradingMode === 'SIMULATION' ? 'LIVE' : 'SIMULATION';
      const res = await fetch('/api/wallet/active-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode })
      });

      if (res.ok) {
        setTradingMode(newMode);

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
    } catch (e) {
      console.error("Toggle Mode Error:", e);
    }
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

    handleManualAction('CLOSE', { id, exitPrice: currentPrice });
  }, [cloudStatus.active, marketData]);



  const fetchData = async (overrideTimeframe) => {
    if (isFetchingBus.current) return; // PREVENT OVERLAP
    isFetchingBus.current = true;

    const currentTf = overrideTimeframe || timeframe;
    const results = {};


    try {

      // 1. Fetch Market Context (Binance)
      // 0. Dynamic Pair Selection (Top Volume + Active Trades)
      let currentPairs = pairs;
      if (loading) { // Only fetch new list on initial load or manual refresh
        try {
          // Fetch Top Pairs
          const topPairs = await fetchTopPairs();

          // Also include any active trade symbols if they are not in the top list
          // This ensures we keep tracking price/logic for open positions even if volume drops
          const activeSymbols = cloudStatus.active.map(t => t.symbol);
          const combined = [...new Set([...topPairs, ...activeSymbols])];

          if (JSON.stringify(combined) !== JSON.stringify(pairs)) {
            setPairs(combined);
            currentPairs = combined;
          }
        } catch (e) {
          console.warn("Using fallback pairs", e);
        }
      }

      // 1. Fetch Prices (Real-Time Ticker for speed)
      // [FIX] Use fetchTickerPrices instead of loop
      const pricesMap = await fetchTickerPrices(currentPairs);

      // 2. Fetch Candles (Simultaneously for all pairs)
      const candlesMap = await fetchCandles(currentPairs, currentTf); // [NEW] Batch Fetch Support

      // 3. Process each pair
      for (const symbol of currentPairs) {
        // [FIX] Use Price from Ticker Map
        const price = pricesMap[symbol];
        if (!price) continue;

        // [FIX] Robust Candle Check
        const klines = candlesMap[symbol];
        if (!klines || klines.length < 50) continue; // Need history for RSI/EMA

        const analysis = {
          ...analyzePair(klines),
          ...analyzeFlow(klines),
          ...analyzeTriple(klines),
          ...analyzeOB(klines),
          ...analyzeHybrid(klines),
          forecast: calculateForecast(klines)
        };

        results[symbol] = {
          symbol,
          price,
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
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(), 4000); // 4s Loop
    return () => clearInterval(interval);
  }, [timeframe, pairs.length]); // Re-init if timeframe changes

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

  const handleConfigChange = (newConfig) => {
    setWalletConfig(newConfig);
    if (newConfig.strategy && newConfig.strategy !== activeStrategy) {
      setActiveStrategy(newConfig.strategy);
    }
    // Also sync trading mode if changed from wallet
    if (newConfig.tradingMode && newConfig.tradingMode !== tradingMode) {
      setTradingMode(newConfig.tradingMode);
    }
  };

  return (
    <div className={styles.appContainer}>
      {/* <ParticlesBackground /> */}
      <MobileNavbar activeTab={mobileTab} onTabChange={handleMobileNav} />

      <main className={styles.mainContent}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            {/* <div className={styles.logo}>SENTINEL <span style={{ color: '#00D9FF' }}>AI</span></div> */}
            <div className={styles.statusBadge}>
              <span className={styles.statusDot} style={{ background: tradingMode === 'LIVE' ? '#EF4444' : '#10B981', boxShadow: tradingMode === 'LIVE' ? '0 0 10px #EF4444' : '0 0 10px #10B981' }}></span>
              {tradingMode} MODE
            </div>
          </div>
          <div className={styles.headerRight}>
            <div className={styles.clock}>{new Date().toLocaleTimeString()} UTC</div>
          </div>
        </header>

        <section id="wallet-section" className={styles.dashboardGrid}>
          {/* Wallet Card - Control Center */}
          <WalletCard
            ref={walletRef}
            onConfigChange={handleConfigChange}
            activeTrades={cloudStatus.active}
            marketData={marketData}
            activeStrategy={activeStrategy}
            tradingMode={tradingMode}
            binanceBalance={binanceBalance}
          />
        </section>

        {/* --- Active Trades Section --- */}
        <section className={styles.portfolioSection}>
          {
            activeTrades.length > 0 && (
              <>
                <h2 className={styles.sectionTitle}>🚀 OPERACIONES ACTIVAS ({cloudStatus.active.length})</h2>
                <div style={{
                  display: 'flex',
                  gap: '15px',
                  overflowX: 'auto',
                  paddingBottom: '10px',
                  marginBottom: '30px'
                }}>
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
          {activeTrades.length === 0 && (
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
          <section style={{ width: '100%', marginTop: '20px' }}>
            <h2 className={styles.sectionTitle}>📊 ANÁLISIS DE MERCADO (TOP 10 VOLUMEN)</h2>
            <MarketGrid>
              {Object.keys(marketData).map(symbol => (
                <SentinelCard
                  key={symbol}
                  symbol={symbol}
                  data={marketData[symbol]}
                  loading={loading}
                  onSimulate={handleSimulate}
                />
              ))}
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

      <MobileNavbar activeTab={mobileTab} onTabChange={handleMobileNav} />
    </div>
  );
}

export default App;
