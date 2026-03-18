import React, { useMemo } from 'react';
import styles from './ActiveTradeCard.module.css';

const ActiveTradeCard = ({ trade, currentPrice, walletConfig, onClose, readOnly }) => {
    // Memoize PnL calculation to avoid recalculating if props didn't change (though React.memo handles the component level)
    const { pnl, profitUsd, isWin, currentVal } = useMemo(() => {
        if (!currentPrice || !trade.entryPrice) return { pnl: 0, profitUsd: 0, isWin: false, currentVal: 0 };

        let rawPnL = 0;
        if (trade.type === 'SHORT') {
            rawPnL = ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
        } else {
            rawPnL = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
        }

        // Realism: Deduct 0.1% Entry Fee
        const netPnL = rawPnL - 0.1;

        const quantity = (trade.investedAmount || 0) / (trade.entryPrice || 1);
        const currentVal = quantity * currentPrice;
        const profitUsd = currentVal - (trade.investedAmount || 0);

        // Final Sanity Check
        const safePnL = isNaN(netPnL) || !isFinite(netPnL) ? 0 : netPnL;
        const safeProfit = isNaN(profitUsd) || !isFinite(profitUsd) ? 0 : profitUsd;

        return {
            pnl: safePnL,
            profitUsd: safeProfit,
            isWin: safePnL >= 0,
            currentVal: isNaN(currentVal) || !isFinite(currentVal) ? 0 : currentVal
        };
    }, [trade.entryPrice, trade.type, trade.investedAmount, currentPrice]);

    // Risk Management Logic
    const { tpPrice, tpDist, slPrice, slDist } = useMemo(() => {
        // 1. STOP LOSS LOGIC
        // Global "No Stop Loss" override check
        const canShowSL = walletConfig.useStopLoss || (trade.isManual && trade.stopLoss);

        let slPrice = null;
        let slDist = 0;

        if (canShowSL) {
            if (trade.stopLoss || trade.dynamicSL) {
                slPrice = trade.stopLoss || trade.dynamicSL;
            } else if (trade.strategy !== 'VOLCANO') {
                // Default Global SL (Skip for Volcano to show "SIN STOP LOSS" at start)
                const dist = walletConfig.stopLoss || 3.0;
                slDist = -dist;
                slPrice = trade.entryPrice * (1 + (slDist / 100));
            }
        }

        if (slPrice) {
            slDist = ((slPrice - trade.entryPrice) / trade.entryPrice) * 100;
        }

        // 2. TAKE PROFIT LOGIC
        let tpPrice = trade.takeProfit || trade.dynamicTP || null;
        let tpDist = 0;

        if (tpPrice) {
            tpDist = ((tpPrice - trade.entryPrice) / trade.entryPrice) * 100;
        } else {
            tpDist = walletConfig.takeProfit || 1.25;
            tpPrice = trade.entryPrice * (1 + (tpDist / 100));
        }

        return { tpPrice, tpDist, slPrice, slDist };
    }, [trade, walletConfig]);

    // Helper for formatting prices based on magnitude
    const formatPrice = (price) => {
        if (!price) return '0.00';
        // For distinctively small coins like PEPE/SHIB (< 0.01)
        if (price < 0.01) {
            return price.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 8 });
        }
        // For cents (< 1)
        if (price < 1) {
            return price.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
        }
        // Standard
        return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    return (
        <div className={styles.card} style={{ borderLeft: `5px solid ${trade.type === 'LONG' ? '#10B981' : '#EF4444'}` }}>
            <div className={styles.header}>
                <div className={styles.tagGroup}>
                    <span className={styles.typeTag} style={{ background: trade.type === 'LONG' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)', color: trade.type === 'LONG' ? '#10B981' : '#EF4444' }}>
                        {trade.type}{trade.isManual ? ' (M)' : ''}
                    </span>
                    <span className={styles.strategyTag}>
                        {trade.strategy || 'AUTO'}
                    </span>
                </div>
                <span className={styles.symbol}>{trade.symbol.replace('USDT', '')}</span>
                {!readOnly && <button className={styles.closeBtn} onClick={() => onClose(trade.id)}>×</button>}
            </div>

            <div className={styles.pnl} style={{ color: isWin ? '#10B981' : '#EF4444' }}>
                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%
            </div>

            <div className={styles.infoRow}>
                <span>Entrada:</span>
                <span className={styles.infoVal}>
                    ${formatPrice(trade.entryPrice)}
                    <span style={{ fontSize: '0.7rem', color: '#94A3B8', marginLeft: '6px', fontWeight: 'normal' }}>
                        ({new Date(trade.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                    </span>
                </span>
            </div>

            {trade.triggerDelta && (
                <div className={styles.infoRow} style={{ color: '#10B981', fontWeight: 'bold' }}>
                    <span>Trigger:</span>
                    <span>${Math.round(trade.triggerDelta).toLocaleString()}</span>
                </div>
            )}

            <div className={styles.targetsGrid}>
                {/* TAKE PROFIT ROW */}
                <div className={`${styles.targetRow} ${styles.tpRow}`}>
                    <div className={styles.tagGroup}>
                        <span style={{ fontSize: '0.65rem', color: '#10B981', fontWeight: '800' }}>🎯 TP</span>
                        <span style={{ fontSize: '0.65rem', color: '#A7F3D0' }}>({tpDist > 0 ? '+' : ''}{tpDist.toFixed(1)}%)</span>
                    </div>
                    <span className={styles.infoVal} style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>
                        ${formatPrice(tpPrice)}
                    </span>
                </div>

                {/* STOP LOSS ROW (Dynamic Trailing UI) */}
                <div className={`${styles.targetRow} ${slPrice > 0 ? styles.slRow : styles.slRowNeutral}`}>
                    <div className={styles.tagGroup}>
                        <span style={{ fontSize: '0.65rem', color: slPrice > 0 ? '#EF4444' : '#94A3B8', fontWeight: '800' }}>🛑 SL</span>
                    </div>
                    <span className={styles.infoVal} style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>
                        {trade.isTrailing ? (
                            <span style={{ 
                                color: '#3B82F6', 
                                background: 'rgba(59, 130, 246, 0.15)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                border: '1px solid rgba(59, 130, 246, 0.3)',
                                textShadow: '0 0 5px rgba(59, 130, 246, 0.3)', 
                                fontSize: '0.65rem',
                                fontWeight: '900'
                            }}>
                                ⛓️ TRAILING ACTIVO
                            </span>
                        ) : (slPrice > 0 ? (
                            <span style={{ color: '#fff' }}>
                                {slDist > 0 ? '+' : ''}{slDist.toFixed(2)}%
                            </span>
                        ) : (
                            <span style={{ 
                                color: '#94A3B8', 
                                background: 'rgba(255, 255, 255, 0.05)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                fontSize: '0.6rem'
                            }}>
                                SIN STOP LOSS
                            </span>
                        ))}
                    </span>
                </div>
            </div>

            <div className={styles.infoRow}>
                <span>Cantidad:</span>
                <span className={styles.infoVal}>{(trade.investedAmount / trade.entryPrice).toFixed(5)} {trade.symbol.replace('USDT', '')}</span>
            </div>

            <div className={styles.infoRow}>
                <span>Valor Actual:</span>
                <span className={styles.infoVal} style={{ color: isWin ? '#10B981' : '#EF4444', fontWeight: 'bold' }}>
                    ${currentVal.toFixed(2)}
                </span>
            </div>

            <div className={styles.investmentBox}>
                <span style={{ fontSize: '0.75rem', color: '#FCD34D', fontWeight: 'bold' }}>💰 INVERSIÓN:</span>
                <span style={{ fontSize: '0.9rem', color: '#FFF', fontWeight: 'bold', fontFamily: 'monospace' }}>
                    ${trade.investedAmount.toFixed(2)}
                </span>
            </div>
        </div>
    );
};

// Optimization: Only re-render if Price or Config changes meaningfully
// Optimization: Only re-render if key props change
export default React.memo(ActiveTradeCard, (prevProps, nextProps) => {
    return (
        prevProps.currentPrice === nextProps.currentPrice &&
        prevProps.trade.id === nextProps.trade.id &&
        prevProps.trade.stopLoss === nextProps.trade.stopLoss && // 👈 WATCH THIS (Trailing updates)
        prevProps.trade.isTrailing === nextProps.trade.isTrailing &&
        prevProps.walletConfig.useStopLoss === nextProps.walletConfig.useStopLoss &&
        prevProps.walletConfig.stopLoss === nextProps.walletConfig.stopLoss &&
        prevProps.walletConfig.takeProfit === nextProps.walletConfig.takeProfit
    );
});
