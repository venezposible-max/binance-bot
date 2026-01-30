import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import styles from './WalletCard.module.css';

const WalletCard = forwardRef(({ onConfigChange, activeTrades, marketData }, ref) => {
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
        const newBalance = prompt('Introduce Capital Inicial (USDT Virtuales):', wallet?.initialBalance || 1000);
        if (newBalance === null) return;

        const newRisk = prompt('Porcentaje de Riesgo por Operación (%):', wallet?.riskPercentage || 10);
        if (newRisk === null) return;

        if (confirm(`⚠ ATENCIÓN: Al cambiar el capital inicial, se restablecerá el saldo actual a $${newBalance}.\n\n¿Estás seguro?`)) {
            try {
                const res = await fetch('/api/wallet/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        initialBalance: parseFloat(newBalance),
                        riskPercentage: parseFloat(newRisk),
                        strategy: wallet?.strategy || 'SWING', // Preserve active strategy
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
        if (!wallet) return 'SWING';
        if (wallet.strategy) return wallet.strategy;
        // Migration for legacy flag
        return wallet.multiFrameMode ? 'TRIPLE' : 'SWING';
    };

    const currentStrategy = getStrategy();

    const handleCycleStrategy = async () => {
        if (!wallet) return;
        const strategies = ['SWING', 'TRIPLE', 'SCALP'];
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

            if (onConfigChange) onConfigChange({ ...wallet, strategy: nextStrategy, multiFrameMode: nextStrategy === 'TRIPLE' });
        } catch (error) {
            console.error('Error cycling strategy:', error);
        }
    };

    const getStrategyColor = (s) => {
        if (s === 'TRIPLE') return '#8B5CF6'; // Purple
        if (s === 'SCALP') return '#F59E0B'; // Orange
        return '#10B981'; // Teal (Default/Swing)
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
