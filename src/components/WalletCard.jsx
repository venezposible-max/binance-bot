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
        // Refresh every 10s to reflect autonomous changes
        const interval = setInterval(fetchWallet, 10000);
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
        const strategies = ['SWING', 'TRIPLE', 'SCALP', 'FLOW', 'SNIPER'];
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
        if (s === 'SWING') return '#3B82F6'; // Blue
        if (s === 'TRIPLE') return '#8B5CF6'; // Violet
        if (s === 'SCALP') return '#F59E0B'; // Amber
        if (s === 'FLOW') return '#00D9FF'; // Neon Blue
        if (s === 'SNIPER') return '#D946EF'; // Neon Magenta
        return '#666';
    };

    const handleToggleBot = async () => {
        if (!wallet) return;
        const newState = !(wallet.isBotActive !== false); // Toggle
        try {
            // Optimistic update
            setWallet(prev => ({ ...prev, isBotActive: newState }));

            await fetch('/api/wallet/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isBotActive: newState })
            });
        } catch (e) {
            console.error(e);
            alert('Error al cambiar estado del bot');
        }
    };

    return (
        <div className={styles.card}>
            {/* Header with Kill Switch */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px' }}>
                <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    💼 BILLETERA
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
                <button
                    onClick={handleToggleBot}
                    style={{
                        background: wallet.isBotActive !== false ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: wallet.isBotActive !== false ? '#10B981' : '#EF4444',
                        border: `1px solid ${wallet.isBotActive !== false ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                        borderRadius: '20px',
                        padding: '6px 14px',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.2s'
                    }}
                >
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: wallet.isBotActive !== false ? '#10B981' : '#EF4444', boxShadow: wallet.isBotActive !== false ? '0 0 8px #10B981' : 'none' }}></div>
                    {wallet.isBotActive !== false ? 'BOT ACTIVO' : 'BOT PAUSADO'}
                </button>
            </div>

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
                    {equity >= wallet.initialBalance ? '+' : ''}{(equity - wallet.initialBalance).toFixed(2)} USD
                </div>
            </div>

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
        </div>
    );
});

export default WalletCard;
