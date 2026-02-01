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

        const useSlInput = confirm('🛡️ ¿Deseas activar un Stop Loss de seguridad GLOBAL?\n(Adicional al SL estructural de la IA)');
        const newUseSL = useSlInput;
        const newSL = newUseSL ? prompt('Distancia del Stop Loss (%):', wallet?.stopLoss || 3.0) : (wallet?.stopLoss || 3.0);

        // 4. Max Trades Configuration
        const maxTradesInput = prompt('Número Máximo de Trades Simultáneos:', wallet?.maxTrades || 3);
        if (maxTradesInput === null) return;
        const maxTrades = parseInt(maxTradesInput);

        // 5. Other Defaults (Still hidden for simplicity as they are less critical)
        const lossLimit = wallet?.dailyLossLimit || 50;
        const cooldown = wallet?.cooldownMinutes || 30;

        const confirmMsg = newMode === 'LIVE'
            ? `⚠️⚠️ PELIGRO: MODO LIVE ⚠️⚠️\n\nEstás a punto de activar DINERO REAL.\nCapital Asignado: $${newBalance}\nRiesgo: ${newRisk}%\nMax Trades: ${maxTrades}\nSL Seguridad: ${newUseSL ? (newSL + '%') : 'OFF'}\n\n¿CONFIRMAS?`
            : `Confirmar Reconfiguración:\nModo: SIMULACIÓN\nSaldo: $${newBalance}\nRiesgo: ${newRisk}%\nSL Seguridad: ${newUseSL ? (newSL + '%') : 'OFF'}`;

        if (confirm(confirmMsg)) {
            try {
                const res = await fetch('/api/wallet/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        initialBalance: parseFloat(newBalance),
                        allocatedCapital: parseFloat(newBalance),
                        tradingMode: newMode,
                        riskPercentage: parseFloat(newRisk),
                        maxTrades: parseInt(maxTrades),
                        dailyLossLimit: parseFloat(lossLimit),
                        cooldownMinutes: parseInt(cooldown),
                        useStopLoss: newUseSL,
                        stopLoss: parseFloat(newSL),
                        strategy: activeStrategy || wallet?.strategy || 'HYBRID_SWING',
                        reset: true
                    })
                });

                if (res.ok) {
                    await fetchWallet();
                    alert('✅ Billetera Reconfigurada Exitosamente');
                } else {
                    const errData = await res.json();
                    throw new Error(errData.error || 'Server rejected config');
                }
            } catch (error) {
                console.error(error);
                alert(`❌ Error al guardar: ${error.message}`);
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
            await fetch('/api/wallet/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ strategy: nextStrategy })
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
            await fetch('/api/wallet/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ strategyConfig: newStrategyConfig, isBotActive: newState })
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
            await fetch('/api/wallet/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ strategyConfig: newStrategyConfig, strategy: strategyName })
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
            await fetch('/api/wallet/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hybridMode: mode })
            });
            if (onConfigChange) onConfigChange({ ...wallet, hybridMode: mode });
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

                {(function () {
                    const isActive = (wallet.strategyConfig || {})[currentStrategy]?.active;
                    return isActive ? (
                        <button onClick={handleToggleBot} className={styles.pauseBtn}>⏸️ PAUSE</button>
                    ) : (
                        <button onClick={handleToggleBot} className={styles.startBtn}>▶️ START</button>
                    );
                })()}
            </div>

            {/* --- MULTI-STRATEGY PANEL --- */}
            <div style={{ marginBottom: '15px', padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {/* --- HYBRID TREE --- */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderLeft: '2px solid rgba(0,217,255,0.2)', paddingLeft: '8px' }}>
                        <div style={{ fontSize: '0.6rem', color: '#00D9FF', opacity: 0.8, marginBottom: '2px' }}>HYBRID ENGINE</div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                            {['HYBRID_SWING', 'HYBRID_BLITZ'].map(s => {
                                const isActive = (wallet.strategyConfig || {})[s]?.active;
                                return (
                                    <button
                                        key={s}
                                        onClick={() => handleToggleStrategyActive(s)}
                                        style={{
                                            padding: '4px 8px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 'bold', cursor: 'pointer',
                                            border: `1px solid ${isActive ? '#00D9FF' : '#333'}`,
                                            background: isActive ? '#00D9FF22' : 'transparent',
                                            color: isActive ? '#00D9FF' : '#64748B'
                                        }}
                                    >
                                        <span>{s === 'HYBRID_SWING' ? '🏛️ SWING' : '⚡ BLITZ'} {isActive ? '✓' : '○'}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* --- SNIPER NODE --- */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderLeft: '2px solid rgba(217,70,239,0.2)', paddingLeft: '8px', marginLeft: '8px' }}>
                        <div style={{ fontSize: '0.6rem', color: '#D946EF', opacity: 0.8, marginBottom: '2px' }}>ELITE SNIPER</div>
                        <button
                            onClick={() => handleToggleStrategyActive('SNIPER')}
                            style={{
                                padding: '4px 8px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 'bold', cursor: 'pointer',
                                border: `1px solid ${(wallet.strategyConfig || {})['SNIPER']?.active ? '#D946EF' : '#333'}`,
                                background: (wallet.strategyConfig || {})['SNIPER']?.active ? '#D946EF22' : 'transparent',
                                color: (wallet.strategyConfig || {})['SNIPER']?.active ? '#D946EF' : '#64748B'
                            }}
                        >
                            <span>🎯 SNIPER {(wallet.strategyConfig || {})['SNIPER']?.active ? '✓' : '○'}</span>
                        </button>
                    </div>

                    {/* --- AI BRAIN INDICATOR (Phase 5) --- */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderLeft: '2px solid rgba(255,165,0,0.2)', paddingLeft: '8px', marginLeft: '8px' }}>
                        <div style={{ fontSize: '0.6rem', color: '#FFA500', opacity: 0.8, marginBottom: '2px' }}>🧠 AI BRAIN</div>
                        <div style={{
                            fontSize: '0.65rem', color: wallet.aiRegime?.color || '#FFA500', fontWeight: 'bold',
                            display: 'flex', alignItems: 'center', gap: '4px'
                        }}>
                            {wallet.aiRegime?.label || 'ANALIZANDO...'}
                            <span style={{ fontSize: '0.6rem', opacity: 0.7, fontWeight: 'normal' }}>
                                ({wallet.aiRegime?.riskMultiplier || 1.0}x Risk)
                            </span>
                        </div>
                    </div>
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
                    <div className={styles.riskItem}>
                        <div className={styles.label}>AUTO EXIT</div>
                        <div style={{ color: '#F59E0B', fontSize: '0.7rem', fontWeight: 'bold' }}>ATR PRECISION ✅</div>
                    </div>
                </div>
            )}

            <div className={styles.configGroup}>
                <div className={styles.statItem}>
                    <div className={styles.label}><span>RIESGO</span></div>
                    <div style={{ fontWeight: 'bold' }}><span>{wallet.riskPercentage}%</span></div>
                </div>
                <div className={styles.statItem} onClick={handleCycleStrategy} style={{ cursor: 'pointer' }}>
                    <div className={styles.label}><span>ESTRATEGIA</span></div>
                    <div style={{ fontWeight: 'bold', color: getStrategyColor(currentStrategy) }}><span>{currentStrategy}</span></div>
                </div>
                <button onClick={handleConfigure} className={styles.configBtn}>⚙</button>
            </div>
        </div>
    );
});

export default WalletCard;
