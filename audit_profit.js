
import 'dotenv/config';
import redis from './api/utils/redisClient.js';

async function auditCore() {
    console.log('\n📊 STARTING PROFITABILITY AUDIT (SIM vs REAL)...\n');

    const suffixSim = '_sim';
    const suffixReal = '_real';
    const historyKeySim = `sentinel_win_history${suffixSim}`;
    const historyKeyReal = `sentinel_win_history${suffixReal}`;

    const [histSimStr, histRealStr] = await redis.mget([historyKeySim, historyKeyReal]);

    const audit = (trades, label) => {
        if (!trades || trades.length === 0) {
            console.log(`\n--- [${label}] ---`);
            console.log("No Data Available.");
            return;
        }

        let wins = 0;
        let losses = 0;
        let grossProfit = 0;
        let grossLoss = 0;
        let totalFees = 0; // Estimated 0.1% per leg (Entry + Exit) = 0.2% total volume

        trades.forEach(t => {
            const pnl = t.profitUsd || t.netProfit || 0;
            // Estimate Fees if not recorded: 0.1% * 2 * Invested
            const estimatedFee = (t.investedAmount || 0) * 0.002;

            if (pnl >= 0) {
                wins++;
                grossProfit += pnl;
            } else {
                losses++;
                grossLoss += Math.abs(pnl);
            }
            totalFees += estimatedFee;
        });

        const totalTrades = wins + losses;
        const winRate = (wins / totalTrades) * 100;
        const netResult = grossProfit - grossLoss; // Fees usually already in Net, but we check logic
        const profitFactor = grossLoss === 0 ? grossProfit : (grossProfit / grossLoss);

        console.log(`\n=== [${label} AUDIT] ===`);
        console.log(`🎲 Total Trades: ${totalTrades}`);
        console.log(`✅ Wins: ${wins} | ❌ Losses: ${losses}`);
        console.log(`🎯 Win Rate: ${winRate.toFixed(2)}%`);
        console.log(`💰 Gross Profit: $${grossProfit.toFixed(2)}`);
        console.log(`💸 Gross Loss:   -$${grossLoss.toFixed(2)}`);
        console.log(`📉 Profit Factor: ${profitFactor.toFixed(2)} ${profitFactor < 1 ? '(LOSING SYSTEM)' : '(PROFITABLE)'}`);
        console.log(`💵 NET RESULT:   $${netResult.toFixed(2)}`);
        console.log(`--------------------------------`);
        console.log(`⚠️ Estimated Fee Impact for Volume: ~$${totalFees.toFixed(2)}`);
        if (netResult > 0 && netResult < totalFees) {
            console.log(`🚨 CRITICAL: You are profitable on paper, but FEES might put you strictly negative.`);
        }
    };

    audit(histSimStr ? JSON.parse(histSimStr) : [], 'SIMULATION');
    audit(histRealStr ? JSON.parse(histRealStr) : [], 'LIVE REAL MONEY');

    process.exit();
}

auditCore();
