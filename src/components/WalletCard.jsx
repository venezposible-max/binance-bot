import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { API_BASE } from '../config/api';
import styles from './WalletCard.module.css';

const WalletCard = forwardRef(({ config, onConfigChange, activeTrades, marketData, activeStrategy, tradingMode, binanceBalance, onToggleMode, readOnly, btcChange }, ref) => {
    const [wallet, setWallet] = useState(config || null);
    const [loading, setLoading] = useState(!config);
    const isSaving = React.useRef(false);

    // Sync from parent prop (the source of truth for all devices)
    useEffect(() => {
        if (!isSaving.current && config && Object.keys(config).length > 0) {
            setWallet(config);
            setLoading(false);
        }
    }, [config]);

    const handleConfigure = async () => {
        if (readOnly) return; // Security Guard
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

        // 4. Max Trades
        const maxTradesInput = prompt('Número Máximo de Trades Simultáneos:', wallet.maxTrades || 3);
        if (maxTradesInput === null) return;
        const maxTrades = parseInt(maxTradesInput);

        // 5. [NEW] Strategy Modules Configuration
        const currentConfig = wallet.strategyConfig?.HYBRID_BLITZ || {};

        // Vortex Toggle
        const useBlitz = confirm(`⚡ MODULO TÉCNICO (VORTEX)\n\n¿Activar análisis de Agotamiento y Velas Heikin Ashi?\nEstado Actual: ${currentConfig.useBlitz !== false ? 'ON' : 'OFF'}\n\n[Aceptar = ON] [Cancelar = OFF]`);

        // Hybrid Toggle
        const useHybrid = confirm(`🧬 MODULO ESTADÍSTICO (HYBRID)\n\n¿Activar filtro de Probabilidades?\nEstado Actual: ${currentConfig.useHybrid !== false ? 'ON' : 'OFF'}\n\n[Aceptar = ON] [Cancelar = OFF]`);

        // UNIXA Toggle
        const useUnixa = confirm(`🪐 ESTRATEGIA UNIXA (EXPERIMENTAL)\n\n¿Activar entradas Ultra-Filtro (RSI < 2)?\nEstado Actual: ${currentConfig.useUnixa === true ? 'ON' : 'OFF'}\n\n[Aceptar = ON] [Cancelar = OFF]`);

        let minOdds = 67;
        if (useHybrid) {
            const minOddsInput = prompt('🧬 Umbral Mínimo de Probabilidad (%):', currentConfig.minOdds || 67);
            if (minOddsInput === null) return;
            minOdds = parseFloat(minOddsInput);
        }

        const confirmMsg = isLive
            ? `🚨 AVISO DE RIESGO REAL 🚨\n\nVAS A OPERAR CON DINERO REAL.\nCapital: $${newCap}\nRiesgo: ${newRisk}%\nEstrategia: [Vortex: ${useBlitz ? 'ON' : 'OFF'}] [Hybrid: ${useHybrid ? 'ON' : 'OFF'}]\n\n¿Estás seguro?`
            : `Confirmar cambios en SIMULACIÓN:\nCapital Virtual: $${newCap}\nRiesgo: ${newRisk}%\n[Vortex: ${useBlitz ? 'ON' : 'OFF'}] [Hybrid: ${useHybrid ? 'ON' : 'OFF'}]`;

        if (confirm(confirmMsg)) {
            // OPTIMISTIC UPDATE: Update UI immediately
            isSaving.current = true; // 🔒 LOCK POLLING

            const optimisticUpdate = {
                ...wallet,
                initialBalance: isLive ? wallet.initialBalance : newCap,
                allocatedCapital: isLive ? newCap : wallet.allocatedCapital,
                riskPercentage: parseFloat(newRisk),
                maxTrades: parseInt(maxTrades),
                tradingMode: tradingMode,
                currentBalance: isLive ? wallet.currentBalance : newCap, // If SIM reset, current = new
                strategyConfig: {
                    ...wallet.strategyConfig,
                    HYBRID_BLITZ: {
                        ...(wallet.strategyConfig?.HYBRID_BLITZ || {}),
                        minOdds: minOdds,
                        useBlitz: useBlitz,
                        useHybrid: useHybrid,
                        useUnixa: useUnixa
                    }
                }
            };

            setWallet(optimisticUpdate);
            if (onConfigChange) onConfigChange(optimisticUpdate); // Propagate up

            try {
                const res = await fetch(`${API_BASE}/api/wallet/config?mode=${tradingMode}`, {
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

                        // [NEW] Update Strategy Config with Modules
                        strategyConfig: {
                            ...wallet.strategyConfig,
                            HYBRID_BLITZ: {
                                ...(wallet.strategyConfig?.HYBRID_BLITZ || {}),
                                minOdds: minOdds,
                                useBlitz: useBlitz,
                                useHybrid: useHybrid,
                                useUnixa: useUnixa
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
            } finally {
                isSaving.current = false; // 🔓 UNLOCK
            }
        }
    };

    // Expose configure function to parent via ref
    useImperativeHandle(ref, () => ({
        configure: handleConfigure
    }));


    if (loading) {
        return (
            <div className={styles.card} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '180px', opacity: 0.5 }}>
                <span>🔄 Conectando con Railway Neural Core...</span>
            </div>
        );
    }

    // Fallback for failed fetch (shows empty wallet instead of nothing)
    if (!wallet) return (
        <div className={styles.card} style={{ border: '1px solid #EF4444', padding: '20px', textAlign: 'center' }}>
            <h3 style={{ color: '#EF4444' }}>⚠️ Connection Error</h3>
            <p style={{ fontSize: '0.8rem', color: '#ccc' }}>No se pudo sincronizar la billetera.</p>
        </div>
    );

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


    // DYNAMIC STRATEGY LABEL: Detects active modules to show precise state
    const getActiveStrategyLabel = () => {
        if (!wallet?.strategyConfig?.HYBRID_BLITZ) return 'VORTEX';
        const cfg = wallet.strategyConfig.HYBRID_BLITZ;
        if (cfg.useUnixa) return '🪐 UNIXA';
        if (cfg.useBlitz && cfg.useHybrid) return '⚡ VORTEX+HYBRID';
        if (cfg.useHybrid) return '🧬 HYBRID';
        return '⚡ VORTEX';
    };
    const currentStrategy = getActiveStrategyLabel();

    // REMOVED: handleCycleStrategy
    // REMOVED: getStrategyColor (Not used in new UI)

    const handleToggleBot = async () => {
        if (readOnly) return; // Security Guard
        if (!wallet) return;

        // Simplified Toggle: Just Toggle global active state
        const newState = !wallet.isBotActive;

        try {
            setWallet(prev => ({ ...prev, isBotActive: newState }));
            await fetch(`${API_BASE}/api/wallet/config?mode=${tradingMode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isBotActive: newState, tradingMode })
            });
            if (onConfigChange) onConfigChange({ ...wallet, isBotActive: newState });
        } catch (e) {
            console.error(e);
        }
    };
    // REMOVED: handleToggleStrategyActive (Only VORTEX now)
    // REMOVED: handleSetHybridMode

    const handleToggleStrategyActive = async (strategyName) => {
        if (readOnly) return; // Security Guard
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
            await fetch(`${API_BASE}/api/wallet/config?mode=${tradingMode}`, {
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
        if (readOnly) return; // Security Guard
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
            isSaving.current = true;
            const newWallet = { ...wallet, strategyConfig: newStrategies };
            setWallet(newWallet);
            if (onConfigChange) onConfigChange(newWallet);

            await fetch(`${API_BASE}/api/wallet/config?mode=${tradingMode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    strategyConfig: newStrategies,
                    tradingMode
                })
            });
        } catch (e) {
            console.error("Hybrid Toggle Error:", e);
        } finally {
            setTimeout(() => { isSaving.current = false; }, 1000);
        }
    };

    const toggleBlitzOnly = async () => {
        if (readOnly) return; // Security Guard
        if (!wallet) return;
        const currentStrategies = wallet.strategyConfig || {};
        const config = currentStrategies['HYBRID_BLITZ'] || { useBlitz: true };
        const newState = !config.useBlitz;

        const newStrategies = {
            ...currentStrategies,
            HYBRID_BLITZ: { ...config, useBlitz: newState }
        };

        try {
            isSaving.current = true;
            const newWallet = { ...wallet, strategyConfig: newStrategies };
            setWallet(newWallet);
            if (onConfigChange) onConfigChange(newWallet);

            await fetch(`${API_BASE}/api/wallet/config?mode=${tradingMode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ strategyConfig: newStrategies, tradingMode })
            });
        } catch (e) {
            console.error(e);
        } finally {
            setTimeout(() => { isSaving.current = false; }, 1000);
        }
    };

    const toggleBtcGuard = async () => {
        if (readOnly) return; // Security Guard
        if (!wallet) return;
        const currentStrategies = wallet.strategyConfig || {};
        const config = currentStrategies['HYBRID_BLITZ'] || { useBtcGuard: false };
        const newState = !config.useBtcGuard;

        const newStrategies = {
            ...currentStrategies,
            HYBRID_BLITZ: { ...config, useBtcGuard: newState }
        };

        try {
            isSaving.current = true;
            const newWallet = { ...wallet, strategyConfig: newStrategies };
            setWallet(newWallet);
            if (onConfigChange) onConfigChange(newWallet);

            await fetch(`${API_BASE}/api/wallet/config?mode=${tradingMode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ strategyConfig: newStrategies, tradingMode })
            });
        } catch (e) {
            console.error(e);
        } finally {
            setTimeout(() => { isSaving.current = false; }, 1000);
        }
    };

    const toggleUnixa = async () => {
        if (readOnly) return; // Security Guard
        if (!wallet) return;
        const currentStrategies = wallet.strategyConfig || {};
        const config = currentStrategies['HYBRID_BLITZ'] || { useUnixa: false };
        const newState = !config.useUnixa;

        const newStrategies = {
            ...currentStrategies,
            HYBRID_BLITZ: { ...config, useUnixa: newState }
        };

        try {
            isSaving.current = true;
            const newWallet = { ...wallet, strategyConfig: newStrategies };
            setWallet(newWallet);
            if (onConfigChange) onConfigChange(newWallet);

            await fetch(`${API_BASE}/api/wallet/config?mode=${tradingMode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ strategyConfig: newStrategies, tradingMode })
            });
        } catch (e) {
            console.error(e);
        } finally {
            setTimeout(() => { isSaving.current = false; }, 1000);
        }
    };

    return (
        <div className={styles.card}>
            {/* ... Header & Left Panel (Unchanged) ... */}
            <div className={styles.headerRow}>
                <div className={styles.titleGroup}>
                    <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>💼 BILLETERA</span>
                        <div className={styles.strategyStatus}>
                            {currentStrategy}
                        </div>
                        {wallet?.tradingMode === 'LIVE' && <span className={styles.liveTag}>LIVE MONEY 💸</span>}
                    </div>
                </div>
                <div className={styles.controlsGroup}>
                    <button onClick={onToggleMode} className={styles.modeToggleBtn} style={{ color: tradingMode === 'LIVE' ? '#EF4444' : '#10B981', borderColor: tradingMode === 'LIVE' ? '#EF4444' : '#10B981', marginRight: '10px' }}>{tradingMode === 'LIVE' ? '🔴 LIVE' : '🟢 SIM'}</button>
                    {!readOnly && <button onClick={handleToggleBot} className={wallet?.isBotActive ? styles.pauseBtn : styles.startBtn}>{wallet?.isBotActive ? '⏸️ PAUSE' : '▶️ START'}</button>}
                </div>
            </div>

            <div className={styles.desktopSplit}>
                <div className={styles.leftPanel}>
                    <div className={styles.mainStats}>
                        <div className={styles.balanceGroup}>
                            <div className={styles.label}><span>CASH</span></div>
                            <div className={styles.value}><span>${currentBalance.toFixed(2)}</span></div>
                        </div>
                        <div className={styles.balanceGroup} style={{ borderLeft: '1px solid #333', paddingLeft: '20px' }}>
                            <div className={styles.label}><span>EQUITY</span></div>
                            <div className={styles.value} style={{ color: equity >= initialBalance ? '#10B981' : '#EF4444' }}><span>${equity.toFixed(2)}</span></div>
                        </div>
                    </div>
                </div>

                {/* RIGHT PANEL - STRATEGY CONTROLS */}
                <div className={styles.rightPanel}>
                    <div className={styles.strategyGrid}>

                        {/* 1. VORTEX TOGGLE (Interactive) */}
                        {(() => {
                            const isBlitzOn = wallet?.strategyConfig?.HYBRID_BLITZ?.useBlitz !== false; // Default ON
                            return (
                                <div
                                    onClick={readOnly ? null : toggleBlitzOnly}
                                    title="Activar/Desactivar Análisis Técnico (Dips)"
                                    style={{
                                        flex: 1,
                                        background: isBlitzOn ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                        border: isBlitzOn ? '1px solid #06B6D4' : '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '8px',
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                        cursor: readOnly ? 'default' : 'pointer',
                                        transition: 'all 0.2s ease',
                                        userSelect: 'none',
                                        padding: '8px',
                                        opacity: readOnly ? 0.7 : 1
                                    }}
                                >
                                    <div style={{ fontSize: '0.9rem', color: isBlitzOn ? '#22D3EE' : '#64748B', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        ⚡ VORTEX
                                    </div>
                                    <div style={{ fontSize: '0.55rem', color: isBlitzOn ? '#fff' : '#64748B', marginTop: '2px' }}>
                                        {isBlitzOn ? 'TECHNICAL' : 'DISABLED'}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* 2. HYBRID TOGGLE */}
                        {(() => {
                            const isHybridOn = wallet?.strategyConfig?.HYBRID_BLITZ?.useHybrid !== false; // Default ON
                            return (
                                <div
                                    onClick={readOnly ? null : toggleHybridBlitz}
                                    title="Activar/Desactivar Filtro Estadístico"
                                    style={{
                                        flex: 1,
                                        background: isHybridOn ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                        border: isHybridOn ? '1px solid #8B5CF6' : '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '8px',
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                        cursor: readOnly ? 'default' : 'pointer',
                                        padding: '8px',
                                        transition: 'all 0.2s ease',
                                        userSelect: 'none',
                                        opacity: readOnly ? 0.7 : 1
                                    }}
                                >
                                    <div style={{ fontSize: '0.9rem', color: isHybridOn ? '#A78BFA' : '#64748B', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        🧬 HYBRID
                                    </div>
                                    <div style={{ fontSize: '0.55rem', color: isHybridOn ? '#fff' : '#64748B', marginTop: '2px' }}>
                                        {isHybridOn ? 'STATS' : 'DISABLED'}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* 3. BTC GUARD TOGGLE */}
                        {(() => {
                            const isGuardOn = wallet?.strategyConfig?.HYBRID_BLITZ?.useBtcGuard === true; // Default OFF
                            return (
                                <div
                                    onClick={readOnly ? null : toggleBtcGuard}
                                    title="Activar/Desactivar Protección contra BTC Crash"
                                    style={{
                                        flex: 1,
                                        background: isGuardOn ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                        border: isGuardOn ? '1px solid #EF4444' : '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '8px',
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                        cursor: readOnly ? 'default' : 'pointer',
                                        padding: '8px',
                                        transition: 'all 0.2s ease',
                                        userSelect: 'none',
                                        opacity: readOnly ? 0.7 : 1
                                    }}
                                >
                                    <div style={{ fontSize: '0.9rem', color: isGuardOn ? '#F87171' : '#64748B', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        🛡️ GUARD
                                    </div>
                                    <div style={{ fontSize: '0.55rem', color: isGuardOn ? '#fff' : '#64748B', marginTop: '2px', fontWeight: 'bold' }}>
                                        {isGuardOn
                                            ? (btcChange !== null ? `${btcChange > 0 ? '+' : ''}${btcChange}% (2h)` : 'PROTECTED')
                                            : 'DISABLED'}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* 4. UNIXA TOGGLE */}
                        {(() => {
                            const isUnixaOn = wallet?.strategyConfig?.HYBRID_BLITZ?.useUnixa === true;
                            return (
                                <div
                                    onClick={readOnly ? null : toggleUnixa}
                                    title="Activar entradas Ultra-Filtro (RSI < 2)"
                                    style={{
                                        flex: 1,
                                        background: isUnixaOn ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                        border: isUnixaOn ? '1px solid #F59E0B' : '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '8px',
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                        cursor: readOnly ? 'default' : 'pointer',
                                        padding: '8px',
                                        transition: 'all 0.2s ease',
                                        userSelect: 'none',
                                        opacity: readOnly ? 0.7 : 1
                                    }}
                                >
                                    <div style={{ fontSize: '0.9rem', color: isUnixaOn ? '#FBBF24' : '#64748B', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        🪐 UNIXA
                                    </div>
                                    <div style={{ fontSize: '0.55rem', color: isUnixaOn ? '#fff' : '#64748B', marginTop: '2px', fontWeight: 'bold' }}>
                                        {isUnixaOn ? 'ULTRA' : 'OFF'}
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
                            {!readOnly && <button onClick={handleConfigure} className={styles.configBtn}>⚙</button>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default WalletCard;
