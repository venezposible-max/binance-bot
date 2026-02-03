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
          const topVolume = await fetchTopPairs();

          // Merge with active cloud trades so we don't lose visibility of open positions
          const activeSymbols = cloudStatus.active.map(t => t.symbol);
          const merged = Array.from(new Set([...topVolume, ...activeSymbols]));

          setPairs(merged);
          currentPairs = merged;
        } catch (e) {
          console.warn('Failed to fetch top pairs, using fallback', e);
        }
      }

      // 1. Fetch Market Context (Binance)
      const promises = currentPairs.map(async (symbol) => {
        try {
          // Standard Fetch (Price History) - Needed for chart visualization even in Flow mode
          const candles = await fetchCandles(symbol, currentTf, 250);

          let analysis;

          // BRANCHING LOGIC: STRATEGY SELECTION
          if (activeStrategy.includes('FLOW')) {
            // 🌊 FLOW MODE: Order Book Imbalance
            const depth = await fetchDepth(symbol);
            analysis = analyzeFlow(depth, candles);
          } else if (activeStrategy.includes('TRIPLE')) {
            // 🧐 TRIPLE LOUPE: 15m + 1h + 4h
            const [k1h, k15m] = await Promise.all([
              fetchCandles(symbol, '1h', 100),
              fetchCandles(symbol, '15m', 100)
            ]);
            analysis = analyzeTriple(candles, k1h, k15m);
          } else if (activeStrategy.includes('OB')) {
            // 📦 OB MODE: Institutional Zones
            analysis = analyzeOB(candles, { mode: activeStrategy });
          } else if (activeStrategy.includes('HYBRID')) {
            // 🧬 ELITE HYBRID: OB + Flow + Trend
            const depth = await fetchDepth(symbol);
            analysis = analyzeHybrid(depth, candles, { mode: activeStrategy });
          } else {
            // 📊 STANDARD MODE: Technicals (RSI/EMA/BB)
            analysis = analyzePair(candles, { ...walletConfig, mode: activeStrategy });
          }

          // [NEW] CRITICAL FIX: Ensure the analysis result always has the correct mode for the UI badge
          if (analysis && analysis.indicators) {
            analysis.indicators.mode = activeStrategy;
          }

          const history = candles.slice(-50).map(c => c.close || parseFloat(c[4]));
          // Note: analysis.price comes from candles, might be slightly old.
          // We will override it below with Ticker Price.

          // DEFENSIVE: Validate analysis structure
          if (!analysis || !analysis.prediction || !analysis.prediction.signal) {
            console.warn(`Invalid analysis structure for ${symbol}:`, analysis);
            return null;
          }



          // ORACLE PREDICTION (New)
          const forecast = calculateForecast(candles);

          // Flatten analysis object so 'prediction' is at top level for SentinelCard
          return { symbol, ...analysis, history, candles: candles.slice(-50), forecast };
        } catch (err) {
          console.warn(`Error fetching ${symbol}:`, err);
          return null;
        }
      });

      const analyzedPairs = (await Promise.all(promises)).filter(p => p !== null);

      // 3. Fetch Real-Time Ticker Prices (Crucial for ZAMA/Global precision)
      // This overrides the 'close' price from candles which might be slightly stale or empty
      const allSymbols = analyzedPairs.map(p => p.symbol);
      const tickerPrices = await fetchTickerPrices(allSymbols);

      // FIX: Populate results object from array
      analyzedPairs.forEach(p => {
        // Override with Real-Time Price if available
        if (tickerPrices[p.symbol]) {
          p.price = tickerPrices[p.symbol];

          // Also update the last history point to match current price (for smooth chart)
          if (p.history && p.history.length > 0) {
            p.history[p.history.length - 1] = p.price;
          }
        }
        results[p.symbol] = p;
      });

      setMarketData(results);


      // 2. Sync with Cloud Sniper (Vercel KV) - Non-blocking
      const statusRes = await fetch('/api/get-status');
      if (statusRes.ok) {
        const data = await statusRes.json();
        setCloudStatus(data);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      isFetchingBus.current = false;
    }
  };



  const handleConfigChange = (newConfig) => {
    if (!newConfig) return;

    // Always sync the full configuration state
    setWalletConfig(newConfig);

    // Check if strategy changed from WalletCard
    if (newConfig.strategy && newConfig.strategy !== activeStrategy) {
      console.log(`🔄 Strategy Changed: ${activeStrategy} -> ${newConfig.strategy}`);

      // REMOVED: setMarketData({}) flash for better fluidity
      // Only set loading to true to show a subtle indicator without clearing current view
      setLoading(true);

      let newTf = '4h';
      if (newConfig.strategy === 'SCALP') newTf = '5m';
      if (newConfig.strategy === 'TRIPLE') newTf = '15m';
      if (newConfig.strategy.includes('BLITZ')) newTf = '5m';
      // FLOW uses 4h for chart visualization (even though it reads Order Book)

      setTimeframe(newTf);
      setActiveStrategy(newConfig.strategy);
      localStorage.setItem('sentinel_strategy', newConfig.strategy);

      // Reload data with new strategy
      setTimeout(() => fetchData(newTf), 100);
    } else {
      setWalletConfig(newConfig || {});
      fetchData();
    }
  };

  // --- INITIAL DATA FETCH ---
  useEffect(() => {
    fetchData();
    // Set up auto-refresh interval (every 90s - optimized)
    const interval = setInterval(() => fetchData(), 90000);
    return () => clearInterval(interval);
  }, [timeframe, activeStrategy, walletConfig]); // Re-fetch when config, strategy or timeframe changes

  // ... (Side effects)

  const activeTrades = cloudStatus.active; // Convenience alias

  return (
    <div className={styles.appContainer} style={{ background: 'var(--bg-dark)', minHeight: '100vh', padding: '10px' }}>
      {/* 1. COMMAND BAR (Compact Header) */}
      <header className={styles.commandBar} style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 20px',
        background: 'rgba(30, 35, 41, 0.95)', // Solid background
        borderBottom: '1px solid #333',
        marginBottom: '15px',
        borderRadius: '4px',
        position: 'sticky', // Make it sticky so it's always visible
        top: 0,
        zIndex: 99999, // NUCLEAR Z-INDEX
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(10px)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: '900', letterSpacing: '-1px', color: 'var(--neon-cyan)' }}>
            BLITZ TERMINAL <span style={{ fontSize: '0.6rem', color: '#666', verticalAlign: 'top' }}>PRO</span>
          </div>
          {/* Status Ticker */}
          <div style={{ display: 'flex', gap: '10px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: '#666' }}>
            <span style={{ color: 'var(--neon-green)' }}>● API: CONNECTED</span>
            <span>LATENCY: 42ms</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <button
            onClick={() => setIsDocsOpen(true)}
            style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '0.8rem' }}
          >
            [MANUAL]
          </button>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--text-bright)' }}>
            {new Date().toLocaleTimeString()} UTC
          </div>
        </div>
      </header>

      {/* 2. MAIN GRID (Wallet + Market Scanner) */}
      <main style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(300px, 1fr) 3fr',
        gap: '15px',
        maxWidth: '1800px',
        margin: '0 auto',
        paddingBottom: '250px', // EXTRA PADDING to clear the Fixed Footer
        position: 'relative',
        zIndex: 1
      }}>
        {/* Left Panel: Wallet & Control */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <WalletCard
            ref={walletRef}
            activeTrades={cloudStatus.active}
            marketData={marketData} // Use full marketData object
            activeStrategy={activeStrategy}
            tradingMode={tradingMode}
            binanceBalance={binanceBalance}
            onConfigChange={handleConfigChange}
          />

          {/* Mode Switcher Mini-Panel */}
          <div className="glass-card" style={{ padding: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#666' }}>ENVIRONMENT</span>
            <div style={{ display: 'flex', gap: '5px' }}>
              <button
                onClick={() => tradingMode !== 'SIMULATION' && toggleTradingMode()}
                style={{
                  padding: '4px 8px',
                  fontSize: '0.7rem',
                  background: tradingMode === 'SIMULATION' ? 'var(--neon-cyan)' : 'transparent',
                  color: tradingMode === 'SIMULATION' ? '#000' : '#666',
                  border: '1px solid #333',
                  borderRadius: '2px',
                  cursor: 'pointer'
                }}
              >
                SIM
              </button>
              <button
                onClick={() => tradingMode !== 'LIVE' && toggleTradingMode()}
                style={{
                  padding: '4px 8px',
                  fontSize: '0.7rem',
                  background: tradingMode === 'LIVE' ? 'var(--neon-red)' : 'transparent',
                  color: tradingMode === 'LIVE' ? '#fff' : '#666',
                  border: '1px solid #333',
                  borderRadius: '2px',
                  cursor: 'pointer'
                }}
              >
                LIVE
              </button>
            </div>
          </div>
        </aside>

        {/* Right Panel: Market Scanner Grid */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '15px', alignContent: 'start' }}>
          {pairs.map((symbol) => (
            <SentinelCard
              key={symbol}
              symbol={symbol}
              data={marketData[symbol]} // Candle & Indicator Data
              loading={!marketData[symbol]}
              onSimulate={handleSimulate}
              walletConfig={walletConfig} // Pass config for logic
              currentPrice={marketData[symbol]?.price} // Real-time Price
            />
          ))}
        </section>
      </main>

      {/* 3. ACTIVE POSITIONS BAR (Sticky Footer) */}
      <footer style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        width: '100%',
        background: 'rgba(30, 35, 41, 0.95)', // Solid background
        borderTop: '1px solid var(--neon-cyan)',
        padding: '10px 20px',
        zIndex: 99999, // NUCLEAR Z-INDEX
        boxShadow: '0 -4px 20px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(10px)'
      }}>
        <div style={{ maxWidth: '1800px', margin: '0 auto', display: 'flex', gap: '20px', overflowX: 'auto', paddingBottom: '5px' }}>
          {activeTrades.length === 0 ? (
            <div style={{ opacity: 0.5, fontSize: '0.8rem', fontStyle: 'italic', padding: '10px' }}>
              Waiting for signals... System Idle.
            </div>
          ) : (
            activeTrades.map((trade) => (
              <ActiveTradeCard
                key={trade.id}
                trade={trade}
                currentPrice={marketData[trade.symbol]?.price || trade.entryPrice}
                walletConfig={walletConfig}
                onClose={handleCloseManual}
              />
            ))
          )}
        </div>
      </footer>

      <DocumentationModal isOpen={isDocsOpen} onClose={() => setIsDocsOpen(false)} />
    </div>
  );
}

export default App;
