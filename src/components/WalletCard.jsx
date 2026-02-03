import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import styles from './WalletCard.module.css';

const WalletCard = forwardRef(({ onConfigChange, activeTrades, marketData, activeStrategy, tradingMode, binanceBalance }, ref) => {
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
                // Ensure statusData has the expected structure { active: [], history: [] }
                // Ensure balanceData has { available, total }
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

        // 3. SL Seguridad (REMOVED for Spot Mode preference)
        // Defaulting to FALSE/0 for Spot freedom. User can manually enable if code supports it later, but UI is clean now.
        const newUseSL = false;
        const newSL = 0;

        // 4. Max Trades
        const maxTradesInput = prompt('Número Máximo de Trades Simultáneos:', wallet.maxTrades || 3);
        if (maxTradesInput === null) return;
        const maxTrades = parseInt(maxTradesInput);

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
                        useStopLoss: newUseSL,
                        stopLoss: parseFloat(newSL),
                        strategy: activeStrategy || wallet.strategy || 'HYBRID_SWING',
                        reset: !isLive // Only full reset simulation balance
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


    const getStrategy = () => {
        // Favor local wallet state as it is more reactive to immediate clicks
        if (wallet?.strategy) return wallet.strategy;
        if (activeStrategy) return activeStrategy;
        return 'HYBRID_SWING';
    };

    const currentStrategy = getStrategy();

    const handleCycleStrategy = async () => {
        if (!wallet) return;
        const strategies = ['HYBRID_SWING', 'HYBRID_BLITZ', 'SNIPER'];
        const currentIndex = strategies.indexOf(currentStrategy);
        const nextStrategy = strategies[(currentIndex + 1) % strategies.length];

        try {
            setWallet(prev => ({ ...prev, strategy: nextStrategy }));
            await fetch(`/api/wallet/config?mode=${tradingMode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ strategy: nextStrategy, tradingMode })
            });
            if (onConfigChange) onConfigChange({ ...wallet, strategy: nextStrategy });
        } catch (e) {
            console.error('Failed to cycle strategy', e);
        }
    };

    const getStrategyColor = (s) => {
        if (s.startsWith('HYBRID')) return '#00D9FF';
        if (s === 'SNIPER') return '#D946EF';
        return '#666';
    };

    const handleToggleBot = async () => {
        if (!wallet) return;
        const strategyConfig = wallet.strategyConfig || {};
        const currentConfig = strategyConfig[currentStrategy] || { active: false };
        const newState = !currentConfig.active;

        const newStrategyConfig = {
            ...strategyConfig,
            [currentStrategy]: { ...currentConfig, active: newState }
        };

        try {
            setWallet(prev => ({ ...prev, strategyConfig: newStrategyConfig, isBotActive: newState }));
            await fetch(`/api/wallet/config?mode=${tradingMode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ strategyConfig: newStrategyConfig, isBotActive: newState, tradingMode })
            });
            if (onConfigChange) onConfigChange({ ...wallet, strategyConfig: newStrategyConfig });
        } catch (e) {
            console.error(e);
        }
    };

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

    const handleSetHybridMode = async (mode) => {
        if (!wallet) return;
        try {
            setWallet(prev => ({ ...prev, hybridMode: mode }));
            await fetch(`/api/wallet/config?mode=${tradingMode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hybridMode: mode, tradingMode })
            });
            if (onConfigChange) onConfigChange({ ...wallet, hybridMode: mode });
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className={styles.card}>
            {/* Header with Execution Control - RESTORED */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px' }}>
                <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>💼 BILLETERA</span>
                    {wallet?.tradingMode === 'LIVE' && (
                        <span style={{
                            fontSize: '0.6rem',
                            background: '#EF4444',
                            color: 'white',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            animation: 'pulse 2s infinite'
                        }}>LIVE MONEY 💸</span>
                    )}
                </div>

                {/* START / STOP CONTROL */}
                <button
                    onClick={handleToggleBot}
                    className={wallet?.isBotActive ? styles.pauseBtn : styles.startBtn}
                    style={{
                        padding: '6px 16px',
                        borderRadius: '6px',
                        border: 'none',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        background: wallet?.isBotActive ? '#F59E0B' : '#10B981',
                        color: wallet?.isBotActive ? '#000' : '#fff',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                    }}
                >
                    {wallet?.isBotActive ? '⏸️ PAUSE' : '▶️ START'}
                </button>
            </div>

            {/* --- BLITZ STATUS PANEL --- */}
            <div style={{ marginBottom: '15px', padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <div style={{ fontSize: '0.8rem', color: '#00D9FF', fontWeight: 'bold' }}>⚡ BLITZ ENGINE ACTIVE</div>
                    <span style={{ fontSize: '0.6rem', color: '#64748B' }}>(5m High Frequency)</span>
                </div>
            </div>

            {/* --- PORTFOLIO HEALTH (Phase 3) --- */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '15px' }}>
                <div className={styles.statMini}>
                    <div className={styles.label}><span>TRADES</span></div>
                    <div style={{ color: (activeTrades?.length || 0) >= (wallet.maxTrades || 3) ? '#EF4444' : '#10B981', fontWeight: 'bold' }}>
                        <span>{activeTrades?.length || 0} / {wallet.maxTrades || 3}</span>
                    </div>
                </div>
                <div className={styles.statMini}>
                    <div className={styles.label}><span>LOSS LIMIT</span></div>
                    <div style={{ color: '#E2E8F0', fontWeight: 'bold' }}><span>${wallet.dailyLossLimit || 50}</span></div>
                </div>
                <div className={styles.statMini}>
                    <div className={styles.label}><span>ATR MODE</span></div>
                    <div style={{ color: '#F59E0B', fontWeight: 'bold' }}><span>AUTO ✅</span></div>
                </div>
            </div>

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

            {/* --- HYBRID ENGINE CONTROLS --- */}
            {currentStrategy.startsWith('HYBRID') && (
                <div className={styles.riskPanel}>
                    <div className={styles.riskItem}>
                        <div className={styles.label}>MODE: {currentStrategy === 'HYBRID_SWING' ? '🏛️ SWING' : '⚡ BLITZ'}</div>
                        <div style={{ fontSize: '0.7rem', color: '#fff' }}>
                            {currentStrategy === 'HYBRID_SWING' ? 'Análisis Velas 1H/4H' : 'Análisis Velas 1m/5m'}
                        </div>
                    </div>

                </div>
            )}

            <div className={styles.configGroup}>
                <div className={styles.statItem}>
                    <div className={styles.label}><span>RIESGO</span></div>
                    <div style={{ fontWeight: 'bold' }}><span>{wallet.riskPercentage}%</span></div>
                </div>
                <div className={styles.statItem}>
                    <div className={styles.label}><span>ESTRATEGIA</span></div>
                    <div style={{ fontWeight: 'bold', color: '#00D9FF' }}><span>BLITZ</span></div>
                </div>
                <button onClick={handleConfigure} className={styles.configBtn}>⚙</button>
            </div>
        </div>
    );
});

export default WalletCard;
