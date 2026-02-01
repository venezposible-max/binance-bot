import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import styles from './WalletCard.module.css';

const WalletCard = forwardRef(({ onConfigChange, activeTrades, marketData, activeStrategy }, ref) => {
    const [wallet, setWallet] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchWallet = async () => {
        try {
            const res = await fetch('/api/wallet/config');
            if (res.ok) {
                const data = await res.json();
                setWallet(data);
                if (onConfigChange) onConfigChange(data);
            }
        } catch (error) {
            console.error('Error fetching wallet:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchWallet();
        // Refresh every 2s for fast multi-device sync
        const interval = setInterval(fetchWallet, 2000);
        return () => clearInterval(interval);
    }, []);

    const handleConfigure = async () => {
        // 1. Select Mode
        const modeInput = prompt('ESCOGE MODO DE EJECUCIÓN:\n1 = SIMULACIÓN (Paper Trading)\n2 = LIVE (Dinero Real 💸)', wallet?.tradingMode === 'LIVE' ? '2' : '1');
        if (modeInput === null) return;
        const newMode = modeInput === '2' ? 'LIVE' : 'SIMULATION';

        // 2. Initial Balance OR Allocated Capital
        const balanceLabel = newMode === 'LIVE' ? '💰 Capital REAL Asignado (USDT Max):' : '🧪 Saldo Virtual Inicial:';
        const defaultBal = newMode === 'LIVE' ? (wallet?.allocatedCapital || 500) : (wallet?.initialBalance || 1000);

        const newBalance = prompt(balanceLabel, defaultBal);
        if (newBalance === null) return;

        // 3. Risk
        const newRisk = prompt('Porcentaje de Riesgo por Operación (%):', wallet?.riskPercentage || 10);
        if (newRisk === null) return;

        const confirmMsg = newMode === 'LIVE'
            ? `⚠️⚠️ PELIGRO: MODO LIVE ⚠️⚠️\n\nEstás a punto de activar DINERO REAL.\nCapital Asignado: $${newBalance}\nRiesgo: ${newRisk}%\n\n¿CONFIRMAS?`
            : `Confirmar Reconfiguración:\nModo: SIMULACIÓN\nSaldo: $${newBalance}\nRiesgo: ${newRisk}%`;

        if (confirm(confirmMsg)) {
            try {
                const res = await fetch('/api/wallet/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        initialBalance: parseFloat(newBalance), // Virtual Balance
                        allocatedCapital: parseFloat(newBalance), // Real Limit
                        tradingMode: newMode,
                        riskPercentage: parseFloat(newRisk),
                        strategy: activeStrategy || wallet?.strategy || 'SWING', // Use current frontend strategy
                        reset: true
                    })
                });
                if (res.ok) {
                    fetchWallet();
                    alert('✅ Billetera Reconfigurada Exitosamente');
                    // FORCE PARENT UPDATE TO STAY ON CURRENT STRATEGY
                    if (onConfigChange) {
                        onConfigChange({
                            initialBalance: parseFloat(newBalance),
                            riskPercentage: parseFloat(newRisk),
                            strategy: currentStrategy // La que tengo en variable local
                        });
                    }
                }
            } catch (error) {
                alert('Error al guardar configuración');
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
    const currentBalance = wallet.currentBalance ?? 1000;
    const initialBalance = wallet.initialBalance ?? 1000;

    const pnl = currentBalance - initialBalance;
    const pnlPercent = ((pnl / initialBalance) * 100).toFixed(2);
    const isPositive = pnl >= 0;

    // Calculate Equity (Balance + Unrealized PnL)
    let unrealizedPnL = 0;
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

                // Value Change - Fees (0.1% entry already paid, needs 0.1% exit estimated)
                // Actually, balance already deducted Entry Fee. So Equity is:
                // Current Value of Position - Estimated Exit Fee.

                // Position Value = Invested * (1 + %Change)
                const positionValue = t.investedAmount * (1 + tradePnlPercent);
                const estimatedExitFee = positionValue * 0.001;
                const netValue = positionValue - estimatedExitFee;

                // Unrealized PnL = Net Value - Cost Basis (Invested)
                // Note: 'Invested' was removed from balance. So we add back the Net Value to get Equity.
                unrealizedPnL += (netValue - t.investedAmount);
            }
        });
    }

    // Equity = Balance (Cash) + Invested Amounts + Unrealized PnL
    // Note: 'currentBalance' has open positions DEDUCTED.
    // So to get Equity we need: Cash (currentBalance) + Current Value of Positions.

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
                // Fallback if no price data yet, assume cost basis
                equity += t.investedAmount * 0.999; // Minus entry fee approx
            }
        });
    }


    const getStrategy = () => {
        if (activeStrategy) return activeStrategy; // Prioritize prop from parent
        if (!wallet) return 'SWING';
        if (wallet.strategy) return wallet.strategy;
        // Migration for legacy flag
        return wallet.multiFrameMode ? 'TRIPLE' : 'SWING';
    };

    const currentStrategy = getStrategy();

    const handleCycleStrategy = async () => {
        if (!wallet) return;
        const strategies = ['HYBRID', 'SNIPER'];
        const currentIndex = strategies.indexOf(currentStrategy);
        const nextStrategy = strategies[(currentIndex + 1) % strategies.length];

        try {
            // Optimistic Update
            setWallet(prev => ({ ...prev, strategy: nextStrategy, multiFrameMode: nextStrategy === 'TRIPLE' }));

            await fetch('/api/wallet/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    strategy: nextStrategy,
                    multiFrameMode: nextStrategy === 'TRIPLE' // Keep legacy flag synced
                })
            });

            // Notify Parent immediately to switch views
            if (onConfigChange) onConfigChange({ ...wallet, strategy: nextStrategy, multiFrameMode: nextStrategy === 'TRIPLE' });
        } catch (e) {
            console.error('Failed to cycle strategy', e);
        }
    };

    const getStrategyColor = (s) => {
        if (s === 'HYBRID') return '#00D9FF'; // Neon Cyan
        if (s === 'SNIPER') return '#D946EF'; // Neon Magenta
        return '#666';
    };

    const handleToggleBot = async () => {
        if (!wallet) return;

        // Determine current status (Default to true/Active if undefined/legacy)
        const strategyConfig = wallet.strategyConfig || {};
        const currentConfig = strategyConfig[currentStrategy] || { active: wallet.isBotActive !== false };

        const newState = !currentConfig.active;

        // New Strategy Config Object
        const newStrategyConfig = {
            ...strategyConfig,
            [currentStrategy]: { ...currentConfig, active: newState }
        };

        try {
            // Optimistic update
            setWallet(prev => ({ ...prev, strategyConfig: newStrategyConfig, isBotActive: newState /* Legacy sync visual */ }));

            await fetch('/api/wallet/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    strategyConfig: newStrategyConfig,
                    isBotActive: newState // Keep legacy sync for now
                })
            });

            if (onConfigChange) onConfigChange({ ...wallet, strategyConfig: newStrategyConfig });
        } catch (e) {
            console.error(e);
            alert('Error al cambiar estado del bot');
        }
    };

    // --- MULTI-STRATEGY TOGGLE ---
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
            setWallet(prev => ({ ...prev, strategyConfig: newStrategyConfig }));
            await fetch('/api/wallet/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ strategyConfig: newStrategyConfig })
            });
            if (onConfigChange) onConfigChange({ ...wallet, strategyConfig: newStrategyConfig });
        } catch (e) {
            console.error(e);
        }
    };

    const handleUpdateRiskValue = async (field, value) => {
        if (!wallet) return;
        try {
            const numericValue = parseFloat(value);
            if (isNaN(numericValue)) return;

            // AUTO-PAUSE on change for safety
            setWallet(prev => ({ ...prev, [field]: numericValue, isBotActive: false }));

            await fetch('/api/wallet/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [field]: numericValue, isBotActive: false })
            });

            if (onConfigChange) onConfigChange({ ...wallet, [field]: numericValue, isBotActive: false });
        } catch (e) {
            console.error(e);
        }
    };

    const handleToggleSL = async () => {
        if (!wallet) return;
        const newState = !wallet.useStopLoss;
        try {
            // AUTO-PAUSE on change for safety
            setWallet(prev => ({ ...prev, useStopLoss: newState, isBotActive: false }));

            await fetch('/api/wallet/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ useStopLoss: newState, isBotActive: false })
            });

            if (onConfigChange) onConfigChange({ ...wallet, useStopLoss: newState, isBotActive: false });
        } catch (e) {
            console.error(e);
        }
    };

    const handleSetSwingMode = async (mode) => {
        if (!wallet) return;
        try {
            // AUTO-PAUSE on change for safety
            setWallet(prev => ({ ...prev, swingMode: mode, isBotActive: false }));

            await fetch('/api/wallet/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ swingMode: mode, isBotActive: false })
            });

            if (onConfigChange) onConfigChange({ ...wallet, swingMode: mode, isBotActive: false });
        } catch (e) {
            console.error(e);
        }
    };

    const handleSetHybridMode = async (mode) => {
        if (!wallet) return;
        try {
            // AUTO-PAUSE on change for safety
            setWallet(prev => ({ ...prev, hybridMode: mode, isBotActive: false }));

            await fetch('/api/wallet/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hybridMode: mode, isBotActive: false })
            });

            if (onConfigChange) onConfigChange({ ...wallet, hybridMode: mode, isBotActive: false });
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className={styles.card}>
            {/* Header with Execution Control */}
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

                {/* PAUSED WARNING / START BUTTON */}
                {(function () {
                    const sConf = wallet.strategyConfig?.[currentStrategy];
                    // Active by default if not strictly false
                    const isActive = sConf ? sConf.active : (wallet.isBotActive !== false);

                    return isActive ? (
                        <button
                            onClick={handleToggleBot}
                            className={styles.pauseBtn}
                        >
                            ⏸️ PAUSE ({currentStrategy})
                        </button>
                    ) : (
                        <button
                            onClick={handleToggleBot}
                            className={styles.startBtn}
                        >
                            ▶️ START ({currentStrategy})
                        </button>
                    );
                })()}
            </div>

            {/* --- MULTI-STRATEGY PARALLEL TOGGLE PANEL --- */}
            <div style={{
                marginBottom: '15px',
                padding: '10px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.1)'
            }}>
                <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginBottom: '8px', fontWeight: 'bold' }}>
                    <span>🎯 ESTRATEGIAS ACTIVAS</span>
                    <span style={{ fontSize: '0.6rem', marginLeft: '6px', color: '#64748B' }}>(Paralelo)</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {['HYBRID', 'SNIPER'].map(s => {
                        const strategyConfig = wallet.strategyConfig || {};
                        const isActive = strategyConfig[s]?.active || (s === currentStrategy && wallet.isBotActive !== false);
                        return (
                            <button
                                key={s}
                                onClick={() => handleToggleStrategyActive(s)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '4px 8px',
                                    borderRadius: '44px',
                                    border: `1px solid ${isActive ? getStrategyColor(s) : '#333'}`,
                                    background: isActive ? `${getStrategyColor(s)}22` : 'transparent',
                                    color: isActive ? getStrategyColor(s) : '#64748B',
                                    cursor: 'pointer',
                                    fontSize: '0.7rem',
                                    fontWeight: 'bold',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <span>{s === 'SNIPER' ? '🔫' : '🧬'}</span>
                                <span>{s}</span>
                                <span style={{ fontSize: '0.6rem', marginLeft: '2px' }}>{isActive ? '✓' : '○'}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className={styles.mainStats}>
                <div className={styles.balanceGroup}>
                    <span className={styles.label}>CAPITAL DISPONIBLE (CASH)</span>
                    <span className={styles.value}>${wallet.currentBalance.toFixed(2)}</span>
                </div>

                <div className={styles.balanceGroup} style={{ borderLeft: '1px solid #333', paddingLeft: '20px' }}>
                    <span className={styles.label}>EQUITY (PATRIMONIO REAL)</span>
                    <span className={styles.value} style={{ color: equity >= wallet.initialBalance ? '#10B981' : '#E2E8F0' }}>
                        ${equity.toFixed(2)}
                    </span>
                    <div style={{ fontSize: '0.75rem', color: equity >= wallet.initialBalance ? '#10B981' : '#EF4444' }}>
                        <span>{equity >= wallet.initialBalance ? '+' : ''}{(equity - wallet.initialBalance).toFixed(2)} USD</span>
                    </div>
                </div>
            </div>

            {/* --- HYBRID ENGINE CONTROLS --- */}
            {currentStrategy === 'HYBRID' && (
                <div className={styles.riskPanel}>
                    <div className={styles.riskItem}>
                        <div className={styles.label}>HYBRID MODE</div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                onClick={() => handleSetHybridMode('SWING')}
                                style={{
                                    padding: '4px 10px',
                                    borderRadius: '4px',
                                    background: (wallet.hybridMode || 'SWING') === 'SWING' ? '#00D9FF' : '#1e1e1e',
                                    color: (wallet.hybridMode || 'SWING') === 'SWING' ? '#000' : '#666',
                                    fontSize: '0.7rem',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >🏛️ SWING</button>
                            <button
                                onClick={() => handleSetHybridMode('BLITZ')}
                                style={{
                                    padding: '4px 10px',
                                    borderRadius: '4px',
                                    background: wallet.hybridMode === 'BLITZ' ? '#F59E0B' : '#1e1e1e',
                                    color: wallet.hybridMode === 'BLITZ' ? '#000' : '#666',
                                    fontSize: '0.7rem',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >⚡ BLITZ</button>
                        </div>
                    </div>

                    <div className={styles.riskItem}>
                        <div className={styles.label}>STOP LOSS</div>
                        <div style={{ color: '#F59E0B', fontSize: '0.7rem', fontWeight: 'bold' }}>AUTOMATIC (STRUCTURAL)</div>
                    </div>
                </div>
            )}

            <div className={styles.configGroup}>
                <div className={styles.statItem}>
                    <div className={styles.label}>RIESGO</div>
                    <div style={{ fontWeight: 'bold', color: '#E2E8F0' }}>{wallet.riskPercentage}%</div>
                </div>

                <div className={styles.statItem} onClick={handleCycleStrategy} style={{ cursor: 'pointer' }}>
                    <div className={styles.label}>ESTRATEGIA</div>
                    <div style={{
                        fontWeight: 'bold',
                        color: getStrategyColor(currentStrategy),
                        border: `1px solid ${getStrategyColor(currentStrategy)}`,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '0.7rem'
                    }}>
                        {currentStrategy}
                    </div>
                </div>

                <button onClick={handleConfigure} className={styles.configBtn}>⚙</button>
            </div>
        </div >
    );
});

export default WalletCard;
