import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import styles from './WalletCard.module.css';

const WalletCard = forwardRef(({ onConfigChange, activeTrades, marketData, activeStrategy, tradingMode, binanceBalance, onToggleMode }, ref) => {
    const [wallet, setWallet] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchWallet = async () => {
        try {
            const modeParam = tradingMode || 'SIMULATION';

            // 1. Parallel Fetch of Critical Data
            const promises = [
                fetch(`/api/wallet/config?mode=${modeParam}`).then(r => r.json()),
                fetch(`/api/get-status`).then(r => r.json())
            ];

            // 2. Conditional Fetch for Real Balance
            if (tradingMode === 'LIVE') {
                promises.push(fetch(`/api/wallet/balance`).then(r => r.json()));
            } else {
                promises.push(Promise.resolve({ available: 0, total: 0 })); // Dummy for Sim
            }

            const [configData, statusData, balanceData] = await Promise.all(promises);

            if (configData) {
                setWallet(configData);

                // 3. Sync Upstream to App.jsx (Signature: status, balance, config)
                if (onConfigChange) {
                    onConfigChange(
                        { active: statusData.active || [], history: statusData.history || [] },
                        balanceData,
                        configData
                    );
                }
            }
        } catch (error) {
            console.error('Error fetching wallet/status:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchWallet();
        const interval = setInterval(fetchWallet, 2000);
        return () => clearInterval(interval);
    }, [tradingMode]);

    const handleConfigure = async () => {
        if (!wallet) return;

        const isLive = tradingMode === 'LIVE';
        const modalTitle = isLive ? '⚙️ CONFIGURACIÓN LIVE (DINERO REAL)' : '⚙️ CONFIGURACIÓN SIMULACIÓN (PAPER TRADING)';

        // 1. Capital Allocation
        let availableReal = binanceBalance?.total || 0;
        let newCap = 0;

        if (isLive) {
            newCap = availableReal; // Auto-set to Binance Real Balance
            if (newCap <= 0) {
                alert("⚠️ ERROR: No tienes saldo disponible en Binance (USDT). El bot no puede operar sin capital.");
                return;
            }
        } else {
            let currentCap = wallet.initialBalance || 1000;
            let newCapInput = prompt(`${modalTitle}\n\n🧪 SALDO VIRTUAL INICIAL:`, currentCap);
            if (newCapInput === null) return;
            newCap = parseFloat(newCapInput);
        }

        // 2. Risk
        const newRisk = prompt('Porcentaje de Riesgo por Operación (%):', wallet.riskPercentage || 10);
        if (newRisk === null) return;

        // 3. SL Seguridad (REMOVED)
        // Defaulting to FALSE/0 for Spot freedom.


        // 4. Max Trades
        const maxTradesInput = prompt('Número Máximo de Trades Simultáneos:', wallet.maxTrades || 3);
        if (maxTradesInput === null) return;
        const maxTrades = parseInt(maxTradesInput);

        // 5. [NEW] Genetic Filter Threshold
        const currentMinOdds = wallet.strategyConfig?.HYBRID_BLITZ?.minOdds || 67;
        const minOddsInput = prompt('🧬 Filtro Genético (% Probabilidad Mínima):\n(Default: 67%)', currentMinOdds);
        if (minOddsInput === null) return;
        const minOdds = parseFloat(minOddsInput);

        const confirmMsg = isLive
            ? `🚨 AVISO DE RIESGO REAL 🚨\n\nVAS A OPERAR CON DINERO REAL.\nCapital: $${newCap}\nRiesgo: ${newRisk}%\n\n¿Estás seguro?`
            : `Confirmar cambios en SIMULACIÓN:\nCapital Virtual: $${newCap}\nRiesgo: ${newRisk}%`;

        if (confirm(confirmMsg)) {
            try {
                const res = await fetch('/api/wallet/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        initialBalance: isLive ? wallet.initialBalance : newCap,
                        allocatedCapital: isLive ? newCap : wallet.allocatedCapital,
                        tradingMode: tradingMode, // Always sync with current mode
                        riskPercentage: parseFloat(newRisk),
                        maxTrades: parseInt(maxTrades),


                        strategy: activeStrategy || wallet.strategy || 'HYBRID_SWING',
                        reset: !isLive, // Only full reset simulation balance

                        // [NEW] Update Strategy Config with Min Odds
                        strategyConfig: {
                            ...wallet.strategyConfig,
                            HYBRID_BLITZ: {
                                ...(wallet.strategyConfig?.HYBRID_BLITZ || {}),
                                minOdds: minOdds
                            }
                        }
                    })
                });

                if (res.ok) {
                    await fetchWallet();
                    alert('✅ Configuración Guardada');
                }
            } catch (error) {
                alert(`❌ Error: ${error.message}`);
            }
        }
    };

    // Expose configure function to parent via ref
    useImperativeHandle(ref, () => ({
        configure: handleConfigure
    }));


    if (loading) return null;
    if (!wallet) return null;

    // Defensive defaults for fresh/empty database
    const isLive = tradingMode === 'LIVE';
    const currentBalance = isLive ? (binanceBalance?.total || 0) : (wallet.currentBalance ?? 1000);
    const initialBalance = isLive ? (wallet.allocatedCapital || currentBalance) : (wallet.initialBalance ?? 1000);

    const pnl = currentBalance - initialBalance;
    const pnlPercent = initialBalance > 0 ? ((pnl / initialBalance) * 100).toFixed(2) : "0.00";

    // Calculate Equity (Balance + Unrealized PnL)
    let equity = currentBalance;
    if (activeTrades && marketData) {
        activeTrades.forEach(t => {
            const currentPrice = marketData[t.symbol]?.price;
            if (currentPrice && t.investedAmount) {
                let tradePnlPercent = 0;
                if (t.type === 'SHORT') {
                    tradePnlPercent = ((t.entryPrice - currentPrice) / t.entryPrice);
                } else {
                    tradePnlPercent = ((currentPrice - t.entryPrice) / t.entryPrice);
                }
                const positionValue = t.investedAmount * (1 + tradePnlPercent);
                const estimatedExitFee = positionValue * 0.001;
                equity += (positionValue - estimatedExitFee);
            } else if (t.investedAmount) {
                equity += t.investedAmount * 0.999;
            }
        });
    }


    // REFACTORED: Only BLITZ Strategy supported
    const currentStrategy = 'BLITZ';

    // REMOVED: handleCycleStrategy
    // REMOVED: getStrategyColor (Not used in new UI)

    const handleToggleBot = async () => {
        if (!wallet) return;

        // Simplified Toggle: Just Toggle global active state
        const newState = !wallet.isBotActive;

        try {
            setWallet(prev => ({ ...prev, isBotActive: newState }));
            await fetch(`/api/wallet/config?mode=${tradingMode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isBotActive: newState, tradingMode })
            });
            if (onConfigChange) onConfigChange({ ...wallet, isBotActive: newState });
        } catch (e) {
            console.error(e);
        }
    };
    // REMOVED: handleToggleStrategyActive (Only BLITZ now)
    // REMOVED: handleSetHybridMode

    const handleToggleStrategyActive = async (strategyName) => {
        if (!wallet) return;
        const strategyConfig = wallet.strategyConfig || {};
        const currentConfig = strategyConfig[strategyName] || { active: false };
        const newState = !currentConfig.active;

        const newStrategyConfig = {
            ...strategyConfig,
            [strategyName]: { ...currentConfig, active: newState }
        };

        try {
            // Update state and also select this strategy to sync the main button
            setWallet(prev => ({ ...prev, strategyConfig: newStrategyConfig, strategy: strategyName }));
            await fetch(`/api/wallet/config?mode=${tradingMode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ strategyConfig: newStrategyConfig, strategy: strategyName, tradingMode })
            });

            if (onConfigChange) {
                onConfigChange({ ...wallet, strategyConfig: newStrategyConfig, strategy: strategyName });
            }
        } catch (e) {
            console.error(e);
        }
    };

    const toggleHybridBlitz = async () => {
        if (!wallet) return;
        const currentStrategies = wallet.strategyConfig || {};
        const hybridConfig = currentStrategies['HYBRID_BLITZ'] || { useHybrid: true }; // Default true if missing

        // Toggle
        const newState = !hybridConfig.useHybrid;

        const newStrategies = {
            ...currentStrategies,
            HYBRID_BLITZ: { ...hybridConfig, useHybrid: newState }
        };

        try {
            // Optimistic Client Update
            const newWallet = { ...wallet, strategyConfig: newStrategies };
            setWallet(newWallet);
            if (onConfigChange) onConfigChange(newWallet); // Propagate up

            // Server Update
            await fetch(`/api/wallet/config?mode=${tradingMode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    strategyConfig: newStrategies,
                    tradingMode
                })
            });
            console.log(`🧬 Hybrid Mode Set to: ${newState ? 'ON' : 'OFF'}`);
        } catch (e) {
            console.error("Hybrid Toggle Error:", e);
        }
    };

    return (
        <div className={styles.card}>
            {/* Header with Execution Control - RESTORED */}
            {/* Header with Execution Control - REFACTORED FOR MOBILE */}
            <div className={styles.headerRow}>
                <div className={styles.titleGroup}>
                    <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>💼 BILLETERA</span>
                        {wallet?.tradingMode === 'LIVE' && (
                            <span className={styles.liveTag}>LIVE MONEY 💸</span>
                        )}
                    </div>
                </div>

                <div className={styles.controlsGroup}>
                    <button
                        onClick={onToggleMode}
                        className={styles.modeToggleBtn}
                        style={{
                            color: tradingMode === 'LIVE' ? '#EF4444' : '#10B981',
                            borderColor: tradingMode === 'LIVE' ? '#EF4444' : '#10B981',
                            marginRight: '10px'
                        }}
                    >
                        {tradingMode === 'LIVE' ? '🔴 LIVE' : '🟢 SIM'}
                    </button>

                    <button
                        onClick={handleToggleBot}
                        className={wallet?.isBotActive ? styles.pauseBtn : styles.startBtn}
                    >
                        {wallet?.isBotActive ? '⏸️ PAUSE' : '▶️ START'}
                    </button>
                </div>
            </div>

            {/* --- DESKTOP SPLIT CONTAINER --- */}
            <div className={styles.desktopSplit}>
                {/* LEFT: FINANCIALS (Big Numbers) */}
                <div className={styles.leftPanel}>
                    <div className={styles.mainStats}>
                        <div className={styles.balanceGroup}>
                            <div className={styles.label}><span>CASH</span></div>
                            <div className={styles.value}><span>${currentBalance.toFixed(2)}</span></div>
                        </div>
                        <div className={styles.balanceGroup} style={{ borderLeft: '1px solid #333', paddingLeft: '20px' }}>
                            <div className={styles.label}><span>EQUITY</span></div>
                            <div className={styles.value} style={{ color: equity >= initialBalance ? '#10B981' : '#EF4444' }}>
                                <span>${equity.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* RIGHT: OPERATIONS (Strategy & Status) */}
                <div className={styles.rightPanel}>
                    {/* BLITZ STATUS */}
                    {/* BLITZ STATUS + HYBRID TOGGLE */}
                    <div style={{ display: 'flex', gap: '10px', width: '100%', marginBottom: '8px' }}>
                        {/* 1. Blitz Badge */}
                        <div className={styles.blitzBadge} style={{ flex: 1, margin: 0, padding: '8px', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center' }}>
                            <div style={{ fontSize: '0.8rem', color: '#00D9FF', fontWeight: 'bold' }}>⚡ BLITZ</div>
                            <span style={{ fontSize: '0.6rem', color: '#64748B' }}>SCALPER</span>
                        </div>

                        {/* 2. Hybrid Toggle 🧬 */}
                        {(() => {
                            const isHybridOn = wallet?.strategyConfig?.HYBRID_BLITZ?.useHybrid !== false; // Default ON
                            return (
                                <div
                                    onClick={toggleHybridBlitz}
                                    title="Activar/Desactivar Filtro Estadístico"
                                    style={{
                                        flex: 1,
                                        background: isHybridOn ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                        border: isHybridOn ? '1px solid #8B5CF6' : '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '8px',
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                        userSelect: 'none'
                                    }}
                                >
                                    <div style={{ fontSize: '0.9rem', color: isHybridOn ? '#A78BFA' : '#64748B', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        🧬 HYBRID
                                    </div>
                                    <div style={{ fontSize: '0.55rem', color: isHybridOn ? '#fff' : '#64748B', marginTop: '2px' }}>
                                        {isHybridOn ? 'PROTECTED' : 'DISABLED'}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                    {/* STATS MINI */}
                    <div className={styles.miniStatsRow}>
                        <div className={styles.statMini}>
                            <div className={styles.label}><span>TRADES</span></div>
                            <div style={{ color: (activeTrades?.length || 0) >= (wallet.maxTrades || 3) ? '#EF4444' : '#10B981', fontWeight: 'bold' }}>
                                <span>{activeTrades?.length || 0} / {wallet.maxTrades || 3}</span>
                            </div>
                        </div>
                        <div className={styles.statMini}>
                            <div className={styles.label}><span>RIESGO</span></div>
                            <div style={{ fontWeight: 'bold' }}><span>{wallet.riskPercentage}%</span></div>
                        </div>
                        <div className={styles.configGroup}>
                            <button onClick={handleConfigure} className={styles.configBtn}>⚙</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default WalletCard;
