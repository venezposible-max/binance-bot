import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
// import ParticlesBackground from './components/ParticlesBackground';
import MobileNavbar from './components/MobileNavbar';
import styles from './App.module.css';
import { TOP_PAIRS as INITIAL_PAIRS, fetchTopPairs, fetchCandles, fetchTickerPrices, fetchDepth } from './api/binance';
import { analyzePair, analyzeFlow } from './utils/analysis';
import MarketGrid from './components/MarketGrid';
import SentinelCard from './components/SentinelCard';
import WalletCard from './components/WalletCard';
import { sendTelegramAlert } from './utils/telegram';

function App() {
  const [pairs, setPairs] = useState(INITIAL_PAIRS); // Dynamic Top 10 Pairs
  const [marketData, setMarketData] = useState({});
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ buy: 0, sell: 0, neutral: 0 });

  const [timeframe, setTimeframe] = useState('4h');
  const [activeStrategy, setActiveStrategy] = useState(() => localStorage.getItem('sentinel_strategy') || 'SWING');

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

  const handleSimulate = useCallback((symbol, price, type) => {
    handleManualAction('OPEN', { symbol, price, type, strategy: activeStrategy });
  }, [activeStrategy]);

  const handleCloseManual = useCallback((id) => {
    // Find the trade to get the symbol and current price
    const trade = cloudStatus.active.find(t => t.id === id);
    const currentPrice = trade ? marketData[trade.symbol]?.price : null;

    handleManualAction('CLOSE', { id, exitPrice: currentPrice });
  }, [cloudStatus.active, marketData]);

  const calculatePnL = (trade, currentPrice) => {
    if (!currentPrice) return 0;
    let rawPnL = 0;
    if (trade.type === 'SHORT') {
      rawPnL = ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
    } else {
      rawPnL = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
    }
    // Realism: Deduct 0.1% Entry Fee (Visual Start at -0.1%)
    return rawPnL - 0.1;
  };

  const fetchData = async (overrideTimeframe) => {
    const currentTf = overrideTimeframe || timeframe;
    const results = {};
    let buyCount = 0;
    let sellCount = 0;
    let neutralCount = 0;

    try {
      setLoading(false); // Quick UI feedback

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
          if (activeStrategy === 'FLOW') {
            // 🌊 FLOW MODE: Order Book Imbalance
            const depth = await fetchDepth(symbol); // Using New Backend Proxy
            const lastPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
            analysis = analyzeFlow(depth, lastPrice);
          } else {
            // 📊 STANDARD MODE: Technicals (RSI/EMA/BB)
            analysis = analyzePair(candles);
          }

          const history = candles.slice(-50).map(c => c.close || parseFloat(c[4]));
          // Note: analysis.price comes from candles, might be slightly old.
          // We will override it below with Ticker Price.

          // DEFENSIVE: Validate analysis structure
          if (!analysis || !analysis.prediction || !analysis.prediction.signal) {
            console.warn(`Invalid analysis structure for ${symbol}:`, analysis);
            return null;
          }

          // LOGIC FIX: Normalized comparison to be bulletproof
          // Compare "ETH" vs "ETHUSDT" correctly by stripping "USDT" from both sides
          const normalize = (s) => (s || '').toUpperCase().replace('USDT', '').trim();

          const isActive = cloudStatus.active.some(t => normalize(t.symbol) === normalize(symbol));

          if (analysis.prediction.signal.includes('BUY')) {
            if (!isActive) buyCount++;
          }
          else if (analysis.prediction.signal.includes('SELL')) {
            sellCount++; // Sells might be exits, keeping count for reference
          }
          else neutralCount++;

          // Flatten analysis object so 'prediction' is at top level for SentinelCard
          return { symbol, ...analysis, history, candles: candles.slice(-50) };
        } catch (err) {
          console.warn(`Error fetching ${symbol}:`, err);
          return null;
        }
      });

      const analyzedPairs = (await Promise.all(promises)).filter(p => p !== null);

      // FIX: Populate results object from array
      analyzedPairs.forEach(p => {
        results[p.symbol] = p;
      });

      setMarketData(results);

      // 2. Sync with Cloud Sniper (Vercel KV) - Non-blocking
      try {
        const res = await fetch('/api/get-status');
        if (res.ok) {
          const data = await res.json();
          setCloudStatus(data);
        }
      } catch (e) {
        console.warn("Cloud Sync not available yet (Normal if local):", e.message);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  // --- REACTIVE STATS CALCULATION ---
  useEffect(() => {
    let buyCount = 0;
    let takenCount = 0;
    let sellCount = 0;
    let neutralCount = 0;

    const normalize = (s) => (s || '').toUpperCase().replace('USDT', '').trim();

    Object.entries(marketData).forEach(([symbol, data]) => {
      const isActive = cloudStatus.active.some(t => normalize(t.symbol) === normalize(symbol));

      if (data.prediction.signal.includes('BUY')) {
        if (!isActive) {
          buyCount++;
        } else {
          takenCount++; // Signal exists AND we have the trade = Taken
        }
      } else if (data.prediction.signal.includes('SELL')) {
        sellCount++;
      } else {
        neutralCount++;
      }
    });

    setStats({ buy: buyCount, taken: takenCount, sell: sellCount, neutral: neutralCount });
  }, [marketData, cloudStatus.active]);


  const handleConfigChange = (newConfig) => {
    // Sync activeStrategy if changed from WalletCard
    if (newConfig?.strategy && newConfig.strategy !== activeStrategy) {
      console.log(`🔄 Strategy Changed: ${activeStrategy} -> ${newConfig.strategy}`);

      // CRITICAL: Clear all previous strategy data to ensure independence
      setMarketData({});
      setStats({ buy: 0, sell: 0, neutral: 0, taken: 0 });
      setLoading(true);

      let newTf = '4h';
      if (newConfig.strategy === 'SCALP') newTf = '5m';
      if (newConfig.strategy === 'TRIPLE') newTf = '15m';
      // FLOW uses 4h for chart visualization (even though it reads Order Book)

      setTimeframe(newTf);
      setActiveStrategy(newConfig.strategy);
      localStorage.setItem('sentinel_strategy', newConfig.strategy);

      // Reload data with new strategy
      setTimeout(() => fetchData(newTf), 100); // Small delay to ensure state is cleared
    } else {
      fetchData();
    }
  };

  // --- INITIAL DATA FETCH ---
  useEffect(() => {
    fetchData();
    // Set up auto-refresh interval (every 90s - optimized)
    const interval = setInterval(() => fetchData(), 90000);
    return () => clearInterval(interval);
  }, [timeframe]); // Re-fetch when timeframe changes

  // ... (Side effects)

  return (
    <div className={styles.appContainer}>
      {/* ... Header ... */}
      {/* <ParticlesBackground /> */}
      <header className={styles.header}>
        <div className={styles.logo}>
          BINANCE <span>SENTINEL</span>
        </div>
        <nav style={{ display: 'flex', gap: '20px', color: '#EAECEF', fontWeight: '600', fontSize: '0.9rem' }}>
          <span style={{ color: '#10B981' }}>● CLOUD SNIPER ACTIVE</span>
          <span style={{ color: 'var(--color-binance-yellow)' }}>
            {activeStrategy} ({timeframe})
          </span>

          {/* REAL BALANCE INDICATOR */}
          {binanceBalance ? (
            !binanceBalance.error ? (
              <span style={{ color: '#FCD34D', border: '1px solid #FCD34D', padding: '0 8px', borderRadius: '4px' }}>
                💰 ${binanceBalance.total?.toFixed(2)}
              </span>
            ) : (
              <span style={{ color: '#EF4444', border: '1px solid #EF4444', padding: '0 8px', borderRadius: '4px' }}>
                ⚠️ CHECK KEYS
              </span>
            )
          ) : (
            <span style={{ opacity: 0.5 }}>⌛ Loading...</span>
          )}
        </nav>
      </header>

      <main className={styles.main}>
        <section className={styles.heroSection}>
          <h1 className={styles.heroTitle}>MARKET SENTINEL AI</h1>
          <p className={styles.heroSubtitle}>
            Patrullando 24/7 de forma autónoma en la nube.
            <br />
            <span style={{ fontSize: '1rem', marginTop: '10px', display: 'block' }} className="text-glow-yellow">
              🔥 {stats.buy + stats.taken} Oportunidades Long Detectadas ({stats.taken} Tomadas)
            </span>
          </p>
        </section>

        <div id="wallet-section">
          <WalletCard
            ref={walletRef}
            onConfigChange={handleConfigChange}
            activeTrades={cloudStatus.active}
            marketData={marketData}
          />
        </div>

        {/* --- Trades Autónomos --- */}
        <section className={styles.portfolioSection}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <h2 className={styles.sectionTitle} style={{ margin: 0 }}>🎯 OPERACIONES ACTIVAS (NUBE)</h2>
            <span style={{
              background: 'rgba(16, 185, 129, 0.1)',
              color: '#10B981',
              fontSize: '0.6rem',
              padding: '2px 8px',
              borderRadius: '20px',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              fontWeight: 'bold'
            }}>24/7 AUTONOMOUS</span>

            <button
              onClick={async () => {
                if (confirm('¿Forzar Escaneo de Oportunidades? (Solo Entradas)')) {
                  try {
                    const btn = document.getElementById('forceScanBtn');
                    btn.innerText = '⚡ Escaneando...';
                    btn.disabled = true;

                    // PASO 1: Solo Detectar y ABRIR Nuevas
                    const opportunities = [];
                    Object.entries(marketData).forEach(([symbol, data]) => {
                      if (data.prediction.signal.includes('BUY')) {
                        // Solo si no está ya activa
                        if (!cloudStatus.active.find(at => at.symbol === symbol)) {
                          opportunities.push({
                            symbol: symbol,
                            type: 'LONG',
                            price: data.price,
                            strategy: activeStrategy // Pass Current Strategy (SCALP/SWING)
                          });
                        }
                      }
                    });

                    // Always trigger Backend Check (even if no local opportunities)
                    // This forces the Cloud to check for EXITS (Profit Targets) immediately.
                    const res = await fetch('/api/check-prices', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ opportunities })
                    });
                    const resData = await res.json();

                    const logs = resData.newAlerts ? resData.newAlerts.join('\n') : 'No logs';
                    alert(`✅ Escaneo Finalizado\n\n📋 REPORTE DE NUBE:\n${logs}\n\n🔄 Estado: ${resData.activeCount} Activas`);

                    // Recargar datos locales
                    const statusRes = await fetch('/api/get-status');
                    const statusData = await statusRes.json();
                    setCloudStatus(statusData);

                    btn.innerText = '⚡ FORCE SCAN';
                    btn.disabled = false;
                  } catch (e) {
                    alert('Error de sincronización: ' + e.message);
                    const btn = document.getElementById('forceScanBtn');
                    if (btn) {
                      btn.innerText = '⚡ FORCE SCAN';
                      btn.disabled = false;
                    }
                  }
                }
              }}
              id="forceScanBtn"
              style={{
                background: 'var(--color-binance-yellow)',
                color: '#000',
                border: 'none',
                borderRadius: '4px',
                padding: '5px 10px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                marginLeft: 'auto'
              }}
            >
              ⚡ FORCE SCAN
            </button>
          </div>

          {cloudStatus.active.length > 0 ? (
            <div className={styles.tradeGrid}>
              {cloudStatus.active.map(t => {
                const pnl = calculatePnL(t, marketData[t.symbol]?.price);
                return (
                  <div key={t.id} className={styles.tradeCard} style={{ borderLeft: `5px solid ${t.type === 'LONG' ? '#10B981' : '#EF4444'}` }}>
                    <div className={styles.tradeCardHeader}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className={styles.tradeTag}>{t.type}{t.isManual ? ' (M)' : ''}</span>
                        <span style={{
                          fontSize: '0.7rem',
                          color: '#E2E8F0',
                          fontWeight: 'bold',
                          marginLeft: '5px',
                          letterSpacing: '0.5px'
                        }}>
                          {t.strategy || 'AUTO'}
                        </span>
                      </div>
                      <span className={styles.tradeSymbol}>{t.symbol.replace('USDT', '')}</span>
                      <button className={styles.closeBtn} onClick={() => handleCloseManual(t.id)}>×</button>
                    </div>
                    <div className={styles.tradePnL} style={{ color: pnl >= 0 ? '#10B981' : '#EF4444' }}>
                      {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%
                    </div>
                    <div className={styles.tradeEntry}>
                      <div>Entrada: <span style={{ color: '#fff' }}>${t.entryPrice.toLocaleString()}</span></div>

                      {t.investedAmount && marketData[t.symbol]?.price && (
                        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                          {/* Quantity Calculation */}
                          {(() => {
                            const quantity = t.investedAmount / t.entryPrice;
                            const currentVal = quantity * marketData[t.symbol].price;
                            const profit = currentVal - t.investedAmount;
                            const isWin = profit >= 0;

                            return (
                              <>
                                <div style={{ fontSize: '0.75rem', color: '#94A3B8', display: 'flex', justifyContent: 'space-between' }}>
                                  <span>Cantidad:</span>
                                  <span style={{ color: '#E2E8F0', fontFamily: 'monospace' }}>
                                    {quantity.toFixed(5)} {t.symbol.replace('USDT', '')}
                                  </span>
                                </div>
                                <div style={{ fontSize: '0.75rem', color: '#94A3B8', display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                                  <span>Valor Actual:</span>
                                  <span style={{ color: isWin ? '#10B981' : '#EF4444', fontWeight: 'bold' }}>
                                    ${currentVal.toFixed(2)}
                                  </span>
                                </div>

                                <div style={{
                                  marginTop: '8px',
                                  padding: '4px 8px',
                                  background: 'rgba(245, 158, 11, 0.1)',
                                  border: '1px solid rgba(245, 158, 11, 0.3)',
                                  borderRadius: '4px',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center'
                                }}>
                                  <span style={{ fontSize: '0.75rem', color: '#FCD34D', fontWeight: 'bold' }}>💰 INVERSIÓN:</span>
                                  <span style={{ fontSize: '0.9rem', color: '#FFF', fontWeight: 'bold', fontFamily: 'monospace' }}>
                                    ${(t.investedAmount || (quantity * t.entryPrice)).toFixed(2)}
                                  </span>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )
                      }
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyPortfolio}>El Cloud Sniper está patrullando... Esperando señal fuerte para entrar.</div>
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
                          <div style={{ fontSize: '0.65rem', color: '#94A3B8', marginBottom: '2px' }}>ENTRADA DE</div>
                          <div style={{ fontSize: '0.85rem', fontFamily: 'monospace', color: '#E2E8F0' }}>
                            ${h.entryPrice ? h.entryPrice.toLocaleString() : '---'}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.65rem', color: '#94A3B8', marginBottom: '2px' }}>SALIDA EN</div>
                          <div style={{ fontSize: '0.85rem', fontFamily: 'monospace', color: statusColor, fontWeight: 'bold' }}>
                            ${(h.exitPrice || h.closePrice) ? (h.exitPrice || h.closePrice).toLocaleString() : '---'}
                          </div>
                        </div>
                      </div>

                      {/* Results Footer */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontSize: '0.7rem', color: '#94A3B8' }}>Resultado Neto</span>
                          <span style={{ color: statusColor, fontWeight: 'bold', fontSize: '1rem' }}>
                            {isWin ? '+' : ''}{h.pnl.toFixed(2)}%
                          </span>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>Valor Final 💵</div>
                          <div style={{ color: '#fff', fontWeight: 'bold', fontFamily: 'monospace', fontSize: '1rem' }}>
                            ${((h.investedAmount || 0) * (1 + (h.pnl || 0) / 100)).toFixed(2)}
                          </div>
                          <div style={{ fontSize: '0.65rem', color: statusColor }}>
                            ({isWin ? '+' : ''}${((h.investedAmount || 0) * ((h.pnl || 0) / 100)).toFixed(2)})
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


        <div id="market-grid-section">
          <MarketGrid>
            {pairs.map(symbol => (
              <SentinelCard
                key={symbol}
                symbol={symbol}
                data={marketData[symbol]}
                loading={loading}
                onSimulate={handleSimulate}
              />
            ))}
          </MarketGrid>
        </div>



        <footer style={{ textAlign: 'center', color: '#5E6673', padding: '40px 20px', fontSize: '0.8rem' }}>
          Cloud Core Running on Vercel Edge • Redis Persistence Active • NFA
        </footer>
      </main>

      <MobileNavbar activeTab={mobileTab} onTabChange={handleMobileNav} />
    </div>
  );
}

export default App;
