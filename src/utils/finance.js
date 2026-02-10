/**
 * 💰 Financial Math & PnL Logic
 * Shared between Frontend (Display) and Backend (Execution)
 * to prevent inconsistent calculations.
 */

/**
 * Calculate PnL Percentage (Return on Investment)
 * @param {number} entryPrice 
 * @param {number} exitPrice 
 * @param {string} type 'LONG' | 'SHORT'
 * @returns {number} Raw PnL percentage (e.g. 5.5 = +5.5%)
 */
export const calculatePnLPercent = (entryPrice, exitPrice, type = 'LONG') => {
    if (!entryPrice || !exitPrice) return 0;

    if (type === 'SHORT') {
        return ((entryPrice - exitPrice) / entryPrice) * 100;
    } else {
        return ((exitPrice - entryPrice) / entryPrice) * 100;
    }
};

/**
 * Calculate Net Profit in USD (after fees)
 * @param {number} entryPrice 
 * @param {number} exitPrice 
 * @param {number} amount Invested Amount (USD)
 * @param {string} type 'LONG' | 'SHORT'
 * @param {number} feeRate Fee per trade (default 0.001 = 0.1%)
 * @returns {object} { netProfit, roi, grossProfit, fees }
 */
export const calculateNetProfit = (entryPrice, exitPrice, amount, type = 'LONG', feeRate = 0.001) => {
    const rawPnL = calculatePnLPercent(entryPrice, exitPrice, type);
    const grossProfit = amount * (rawPnL / 100);
    const grossReturn = amount + grossProfit;

    // Fees: Entry Fee + Exit Fee
    // Usually entry fee is deduced from initial amount, exit fee from result.
    // Simplified: 2 * feeRate * amount (approx)
    // Accurate: 
    // Entry Fee = amount * feeRate
    // Exit Fee = grossReturn * feeRate

    const entryFee = amount * feeRate;
    const exitFee = grossReturn * feeRate;
    const totalFees = entryFee + exitFee;

    const netReturn = grossReturn - totalFees;
    const netProfit = netReturn - amount;
    const netRoi = (netProfit / amount) * 100;

    const netProfitVal = isNaN(netProfit) || !isFinite(netProfit) ? 0 : netProfit;
    const netRoiVal = isNaN(netRoi) || !isFinite(netRoi) ? 0 : netRoi;

    return {
        netProfit: parseFloat(netProfitVal.toFixed(2)),
        roi: parseFloat(netRoiVal.toFixed(2)), // Net Return %
        grossProfit: parseFloat((grossProfit || 0).toFixed(2)),
        fees: parseFloat((totalFees || 0).toFixed(3))
    };
};
