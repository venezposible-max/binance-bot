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

import HistoryModal from './components/HistoryModal'; // NEW

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

  const [isDocsOpen, setIsDocsOpen] = useState(false); // Documentation State
  const [isHistoryOpen, setIsHistoryOpen] = useState(false); // NEW: History State

  // ... (unchanged code) ...

  // IN HEADER RENDER
  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
    <button
      onClick={() => setIsHistoryOpen(true)}
      style={{ background: 'var(--neon-cyan)', border: 'none', color: '#000', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold', padding: '4px 10px', borderRadius: '4px' }}
    >
      📜 HISTORIAL
    </button>
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
      </header >

    {/* 2. MAIN GRID (Wallet + Market Scanner) */ }
    < main style = {{
    display: 'grid',
      gridTemplateColumns: 'minmax(350px, 350px) 1fr', // FIXED WIDTH SIDEBAR (Prevent collapse/overlap)
        gap: '20px',
          maxWidth: '1800px',
            margin: '0 auto',
              paddingBottom: '250px',
                position: 'relative',
                  zIndex: 1, // Base Layer
                    alignItems: 'start' // Prevent stretching
  }
}>
  {/* Left Panel: Wallet & Control - STICKY SIDEBAR */ }
  < aside style = {{
  display: 'flex',
    flexDirection: 'column',
      gap: '15px',
        position: 'sticky',
          top: '90px', // Below the sticky header
            zIndex: 50 // Above base content, below header
}}>
  <WalletCard
    ref={walletRef}
    activeTrades={cloudStatus.active}
    marketData={marketData} // Use full marketData object
    activeStrategy={activeStrategy}
    tradingMode={tradingMode}
    binanceBalance={binanceBalance}
    onConfigChange={handleConfigChange}
  />

{/* Mode Switcher Mini-Panel */ }
<div className="glass-card" style={{ padding: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(30,35,41,0.8)', border: '1px solid rgba(255,255,255,0.05)' }}>
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
        </aside >

  {/* Right Panel: Market Scanner Grid */ }
  < section style = {{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '15px', alignContent: 'start', zIndex: 1 }}>
  {
    pairs.map((symbol) => (
      <SentinelCard
        key={symbol}
        symbol={symbol}
        data={marketData[symbol]} // Candle & Indicator Data
        loading={!marketData[symbol]}
        onSimulate={handleSimulate}
        walletConfig={walletConfig} // Pass config for logic
        currentPrice={marketData[symbol]?.price} // Real-time Price
      />
    ))
  }
        </section >
      </main >

  {/* 3. ACTIVE POSITIONS BAR (Sticky Footer) */ }
  < footer style = {{
  position: 'fixed',
    bottom: 0,
      left: 0,
        width: '100%',
          background: '#1E2329', // SOLID BACKGROUND
            borderTop: '1px solid var(--neon-cyan)',
              padding: '10px 20px',
                zIndex: 1000000, // SUPER NUCLEAR Z-INDEX
                  boxShadow: '0 -4px 20px rgba(0,0,0,0.8)'
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
      </footer >

  <DocumentationModal isOpen={isDocsOpen} onClose={() => setIsDocsOpen(false)} />
  <HistoryModal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} mode={tradingMode} />
    </div >
  );
}

export default App;
