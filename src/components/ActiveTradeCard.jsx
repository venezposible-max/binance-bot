import React, { useMemo } from 'react';
import styles from './ActiveTradeCard.module.css';

const ActiveTradeCard = ({ trade, currentPrice, walletConfig, onClose }) => {
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

        const quantity = trade.investedAmount / trade.entryPrice;
        const currentVal = quantity * currentPrice;
        const profitUsd = currentVal - trade.investedAmount;

        return {
            pnl: netPnL,
            profitUsd,
            isWin: netPnL >= 0,
            currentVal
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
            } else {
                // Default Global SL
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
                <button className={styles.closeBtn} onClick={() => onClose(trade.id)}>×</button>
            </div>

            <div className={styles.pnl} style={{ color: isWin ? '#10B981' : '#EF4444' }}>
                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%
            </div>

            <div className={styles.infoRow}>
                <span>Entrada:</span>
                <span className={styles.infoVal}>${trade.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
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
                        ${tpPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </span>
                </div>

                {/* STOP LOSS ROW */}
                <div className={`${styles.targetRow} ${slPrice ? styles.slRow : styles.slRowNeutral}`}>
                    <div className={styles.tagGroup}>
                        <span style={{ fontSize: '0.65rem', color: slPrice ? '#EF4444' : '#94A3B8', fontWeight: '800' }}>🛑 SL</span>
                        {slPrice && <span style={{ fontSize: '0.65rem', color: '#FECACA' }}>({slDist.toFixed(1)}%)</span>}
                    </div>
                    <span className={styles.infoVal} style={{ fontSize: '0.8rem', fontWeight: 'bold', color: slPrice ? '#fff' : '#94A3B8' }}>
                        {slPrice
                            ? `$${slPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
                            : 'SIN S/L'
                        }
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
export default React.memo(ActiveTradeCard, (prevProps, nextProps) => {
    return (
        prevProps.currentPrice === nextProps.currentPrice &&
        prevProps.trade.id === nextProps.trade.id &&
        prevProps.trade.entryPrice === nextProps.trade.entryPrice && // Trade updates (rare)
        prevProps.walletConfig.useStopLoss === nextProps.walletConfig.useStopLoss &&
        prevProps.walletConfig.stopLoss === nextProps.walletConfig.stopLoss &&
        prevProps.walletConfig.takeProfit === nextProps.walletConfig.takeProfit
    );
});
