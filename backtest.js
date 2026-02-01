import axios from 'axios';
import { RSI } from 'technicalindicators';

async function runBacktest() {
    console.log('🔄 Fetching Historical Data for BTCUSDT (4h SWING)...');

    try {
        // Fetch 1000 candles of 4 hours
        // 1000 * 4 = 4000 hours / 24 = ~166 days (5.5 months)
        const url = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=1000';
        const { data } = await axios.get(url);

        // Data format: [time, open, high, low, close, volume, ...]
        const closes = data.map(c => parseFloat(c[4]));
        const highs = data.map(c => parseFloat(c[2]));
        const lows = data.map(c => parseFloat(c[3]));
        const times = data.map(c => new Date(c[0]).toLocaleString());

        console.log(`📊 Data Points: ${closes.length} candles (~5.5 months)`);

        // Calculate RSI
        const rsiInput = {
            values: closes,
            period: 14
        };
        const rsiValues = RSI.calculate(rsiInput);

        // Pad RSI
        const pad = new Array(14).fill(null);
        const fullRSI = [...pad, ...rsiValues];

        // Simulation State
        let balance = 1000;
        let position = null;
        let tradeHistory = [];

        // Loop
        for (let i = 50; i < closes.length; i++) {
            const currentPrice = closes[i];
            const currentRSI = fullRSI[i];
            const timestamp = times[i];
            const high = highs[i];
            const low = lows[i];

            // 1. CHECK EXIT if In Position
            if (position) {
                // Swing Strategy Exits:
                // 1. Profit Target: 3.5% (To catch the wave)
                // 2. Stop Loss: 2.0% (Give it room to breathe)
                // 3. RSI Overbought: RSI > 70 (Trend exhaust)

                const maxWin = (high - position.entryPrice) / position.entryPrice * 100;
                const maxLoss = (low - position.entryPrice) / position.entryPrice * 100;

                let exitPrice = null;
                let reason = '';

                // TP: 3.5%
                if (maxWin >= 3.5) {
                    exitPrice = position.entryPrice * 1.035;
                    reason = 'TP (+3.5%) 🎯';
                }
                // SL: -2.0%
                else if (maxLoss <= -2.0) {
                    exitPrice = position.entryPrice * 0.98;
                    reason = 'SL (-2.0%) 🛡️';
                }
                // RSI Overbought Exit (> 70)
                else if (currentRSI > 70) {
                    exitPrice = currentPrice;
                    reason = 'RSI Overbought (>70) 📉';
                }

                if (exitPrice) {
                    const profit = (exitPrice - position.entryPrice) * position.size;
                    const fee = (exitPrice * position.size) * 0.001;

                    balance += profit - fee;
                    tradeHistory.push({
                        type: 'SELL',
                        reason,
                        entry: position.entryPrice.toFixed(2),
                        exit: exitPrice.toFixed(2),
                        pnlPct: ((exitPrice - position.entryPrice) / position.entryPrice * 100).toFixed(2) + '%',
                        pnl: profit - fee,
                        time: timestamp
                    });
                    position = null;
                    continue;
                }
            }

            // 2. CHECK ENTRY if No Position
            if (!position) {
                // SWING ENTRY: RSI < 30 (Classic Oversold)
                if (currentRSI < 30) {
                    const size = balance / currentPrice;
                    const fee = balance * 0.001;
                    balance -= fee;

                    position = {
                        entryPrice: currentPrice,
                        size: size,
                        time: timestamp
                    };
                }
            }
        }

        // Summary
        const wins = tradeHistory.filter(t => t.pnl > 0).length;
        const losses = tradeHistory.filter(t => t.pnl <= 0).length;
        const totalTrades = tradeHistory.length;
        const netProfit = balance - 1000;
        const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) : 0;

        console.log('\n====== 🧪 RESULTADOS BACKTEST (SWING 4h) ======');
        console.log(`Período: Últimos ~5.5 Meses`);
        console.log(`Par: BTCUSDT`);
        console.log(`Estrategia: RSI < 30 Entry | TP 3.5% / SL 2.0% / RSI > 70 Exit`);
        console.log('----------------------------------------------------');
        console.log(`💰 Saldo Final:      $${balance.toFixed(2)}`);
        console.log(`📈 Beneficio Neto:   $${netProfit.toFixed(2)} (${((balance / 1000 - 1) * 100).toFixed(2)}%)`);
        console.log(`🔢 Total Trades:     ${totalTrades}`);
        console.log(`✅ Ganadas:          ${wins}`);
        console.log(`❌ Perdidas:         ${losses}`);
        console.log(`🎯 Win Rate:         ${winRate}%`);
        console.log('----------------------------------------------------');

        if (totalTrades > 0) {
            console.log('Últimos 5 Trades:');
            console.table(tradeHistory.slice(-5));
        }

    } catch (e) {
        console.error('Error in Backtest:', e.message);
    }
}

runBacktest();
