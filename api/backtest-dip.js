import axios from 'axios';
import { RSI } from 'technicalindicators';

// ============================================================
// 🧪 BACKTEST: HYBRID SMART DIP vs VOLCANO
// Endpoint para correr en Railway (tiene acceso a Binance API)
// ============================================================

const TRADING_FEE = 0.001;
const DIP_THRESHOLD = -3.0;
const RSI_ENTRY = 35;
const RSI_PERIOD = 14;
const TRAILING_START = 2.0;
const TRAILING_LOCK = 1.5;
const EMERGENCY_SL = -5.0;
const TIMEOUT_HOURS = 48;
const INITIAL_CAPITAL = 60;
const RISK_PER_TRADE = 33;
const MAX_SIMULTANEOUS = 3;

async function getTop20Symbols() {
    const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr', { timeout: 10000 });
    const BLACKLIST = ['USDC','FDUSD','TUSD','BUSD','DAI','USDP','PAXG','WBTC','USD1','USDE','PEPE','NEAR','AEUR','EUR','GBP'];
    
    const relevant = res.data.filter(p => {
        if (!p.symbol.endsWith('USDT')) return false;
        const base = p.symbol.replace('USDT', '');
        if (BLACKLIST.includes(base)) return false;
        return parseFloat(p.quoteVolume) > 10000000;
    });
    
    relevant.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
    return relevant.slice(0, 20).map(p => p.symbol);
}

async function fetchKlines(symbol, interval, limit) {
    try {
        const res = await axios.get('https://api.binance.com/api/v3/klines', {
            params: { symbol, interval, limit },
            timeout: 10000
        });
        return res.data.map(c => ({
            time: c[0],
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5])
        }));
    } catch (e) {
        return [];
    }
}

export default async function handler(req, res) {
    try {
        const startTime = Date.now();
        const symbols = await getTop20Symbols();
        
        // ========== Load all data ==========
        const allData = {};
        for (const symbol of symbols) {
            const klines = await fetchKlines(symbol, '1h', 720);
            if (klines.length < 50) continue;
            allData[symbol] = klines;
            await new Promise(r => setTimeout(r, 50));
        }

        // ========== SMART DIP ==========
        let dipCapital = INITIAL_CAPITAL;
        const dipTrades = [];
        const dipActiveTrades = [];

        const timeline = [];
        for (const [symbol, klines] of Object.entries(allData)) {
            klines.forEach((k, idx) => {
                if (idx < 25) return;
                timeline.push({ symbol, kline: k, idx, klines });
            });
        }
        timeline.sort((a, b) => a.kline.time - b.kline.time);

        for (const step of timeline) {
            const { symbol, kline, idx, klines } = step;
            const currentPrice = kline.close;
            const currentTime = kline.time;

            // --- CHECK EXITS ---
            for (let i = dipActiveTrades.length - 1; i >= 0; i--) {
                const trade = dipActiveTrades[i];
                if (trade.symbol !== symbol) continue;

                const pnl = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
                const hoursHeld = (currentTime - trade.entryTime) / 3600000;

                if (currentPrice > trade.highWatermark) trade.highWatermark = currentPrice;

                let exitReason = null;

                if (pnl >= TRAILING_START) trade.trailingActive = true;
                if (trade.trailingActive && pnl <= TRAILING_LOCK) exitReason = 'TRAILING_LOCK';
                if (pnl <= EMERGENCY_SL) exitReason = 'EMERGENCY_SL';
                if (hoursHeld >= TIMEOUT_HOURS && pnl > -1) exitReason = 'TIMEOUT';

                if (exitReason) {
                    const grossReturn = (currentPrice / trade.entryPrice) * trade.invested;
                    const netReturn = grossReturn * (1 - TRADING_FEE);
                    const profit = netReturn - trade.invested;
                    dipCapital += netReturn;

                    dipTrades.push({
                        symbol, entry: trade.entryPrice.toFixed(4), exit: currentPrice.toFixed(4),
                        pnlPct: +pnl.toFixed(2), pnlUsd: +profit.toFixed(2),
                        reason: exitReason, hoursHeld: +hoursHeld.toFixed(1),
                        rsi: trade.rsiAtEntry, dip: trade.dipPct
                    });
                    dipActiveTrades.splice(i, 1);
                }
            }

            // --- CHECK ENTRY ---
            if (dipActiveTrades.length >= MAX_SIMULTANEOUS) continue;
            if (dipActiveTrades.find(t => t.symbol === symbol)) continue;
            if (dipCapital < 5) continue;

            const lookback = klines.slice(Math.max(0, idx - 24), idx);
            const high24h = Math.max(...lookback.map(k => k.high));
            const dipFromHigh = ((currentPrice - high24h) / high24h) * 100;

            const closesForRSI = klines.slice(0, idx + 1).map(k => k.close);
            const rsiValues = RSI.calculate({ values: closesForRSI, period: RSI_PERIOD });
            const currentRSI = rsiValues[rsiValues.length - 1];

            if (dipFromHigh <= DIP_THRESHOLD && currentRSI && currentRSI < RSI_ENTRY) {
                const investAmount = Math.min(dipCapital, (dipCapital * RISK_PER_TRADE / 100));
                dipActiveTrades.push({
                    symbol, entryPrice: currentPrice,
                    invested: investAmount * (1 - TRADING_FEE),
                    entryTime: currentTime, highWatermark: currentPrice,
                    trailingActive: false,
                    rsiAtEntry: +currentRSI.toFixed(1), dipPct: +dipFromHigh.toFixed(1)
                });
                dipCapital -= investAmount;
            }
        }

        // Close remaining
        for (const trade of dipActiveTrades) {
            const lastK = allData[trade.symbol]?.[allData[trade.symbol].length - 1];
            if (lastK) {
                const pnl = ((lastK.close - trade.entryPrice) / trade.entryPrice) * 100;
                const grossReturn = (lastK.close / trade.entryPrice) * trade.invested;
                const netReturn = grossReturn * (1 - TRADING_FEE);
                dipCapital += netReturn;
                dipTrades.push({
                    symbol: trade.symbol, entry: trade.entryPrice.toFixed(4), exit: lastK.close.toFixed(4),
                    pnlPct: +pnl.toFixed(2), pnlUsd: +(netReturn - trade.invested).toFixed(2),
                    reason: 'STILL_OPEN', hoursHeld: 0, rsi: trade.rsiAtEntry, dip: trade.dipPct
                });
            }
        }

        // ========== VOLCANO ==========
        let volCap = INITIAL_CAPITAL;
        const volTrades = [];
        let volActive = null;

        for (const [symbol, klines] of Object.entries(allData)) {
            for (let i = 25; i < klines.length; i++) {
                const currentPrice = klines[i].close;

                if (volActive && volActive.symbol === symbol) {
                    if (klines[i].high > volActive.hw) volActive.hw = klines[i].high;
                    const trailingLine = volActive.hw * (1 - 0.015);
                    const pnl = ((currentPrice - volActive.ep) / volActive.ep) * 100;

                    if (currentPrice <= trailingLine && currentPrice > volActive.ep) {
                        const gross = (currentPrice / volActive.ep) * volActive.inv;
                        const net = gross * (1 - TRADING_FEE);
                        volCap += net;
                        volTrades.push({ symbol, pnlPct: +pnl.toFixed(2), pnlUsd: +(net - volActive.inv).toFixed(2), reason: 'TRAILING' });
                        volActive = null;
                    }
                }

                if (!volActive && volCap >= 10) {
                    const prev = klines.slice(i - 24, i);
                    const maxH = Math.max(...prev.map(k => k.high));
                    const minL = Math.min(...prev.map(k => k.low));
                    const range = minL > 0 ? ((maxH - minL) / minL) * 100 : 99;
                    const prevVols = klines.slice(i - 20, i).map(k => k.volume);
                    const avgVol = prevVols.reduce((a, b) => a + b, 0) / prevVols.length;
                    const volRatio = avgVol > 0 ? klines[i].volume / avgVol : 0;

                    if (range <= 2.5 && volRatio >= 3.0 && currentPrice > maxH) {
                        volActive = { symbol, ep: currentPrice, inv: volCap * (1 - TRADING_FEE), hw: currentPrice };
                        volCap = 0;
                    }
                }
            }
        }
        if (volActive) {
            const lastK = allData[volActive.symbol]?.[allData[volActive.symbol].length - 1];
            if (lastK) {
                const pnl = ((lastK.close - volActive.ep) / volActive.ep) * 100;
                volCap += volActive.inv * (1 + pnl / 100) * (1 - TRADING_FEE);
                volTrades.push({ symbol: volActive.symbol, pnlPct: +pnl.toFixed(2), pnlUsd: +(volActive.inv * pnl / 100).toFixed(2), reason: 'STILL_OPEN' });
            }
        }

        // ========== RESULTS ==========
        const dipWins = dipTrades.filter(t => t.pnlUsd > 0).length;
        const dipLosses = dipTrades.filter(t => t.pnlUsd <= 0).length;
        const dipTotalPnl = dipTrades.reduce((a, t) => a + t.pnlUsd, 0);
        const dipWinRate = dipTrades.length > 0 ? +(dipWins / dipTrades.length * 100).toFixed(1) : 0;
        const dipAvgWin = dipWins > 0 ? +(dipTrades.filter(t => t.pnlUsd > 0).reduce((a, t) => a + t.pnlPct, 0) / dipWins).toFixed(2) : 0;
        const dipAvgLoss = dipLosses > 0 ? +(dipTrades.filter(t => t.pnlUsd <= 0).reduce((a, t) => a + t.pnlPct, 0) / dipLosses).toFixed(2) : 0;

        const volWins = volTrades.filter(t => t.pnlUsd > 0).length;
        const volTotalPnl = volTrades.reduce((a, t) => a + t.pnlUsd, 0);
        const volWinRate = volTrades.length > 0 ? +(volWins / volTrades.length * 100).toFixed(1) : 0;

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        res.status(200).json({
            elapsed: `${elapsed}s`,
            coins: symbols,
            dataPoints: Object.values(allData).reduce((a, k) => a + k.length, 0),
            smartDip: {
                capitalInicial: INITIAL_CAPITAL,
                capitalFinal: +dipCapital.toFixed(2),
                gananciaNeta: +dipTotalPnl.toFixed(2),
                roi: +((dipTotalPnl / INITIAL_CAPITAL) * 100).toFixed(2),
                totalTrades: dipTrades.length,
                ganadores: dipWins,
                perdedores: dipLosses,
                winRate: dipWinRate,
                avgWin: dipAvgWin,
                avgLoss: dipAvgLoss,
                trades: dipTrades
            },
            volcano: {
                capitalInicial: INITIAL_CAPITAL,
                capitalFinal: +volCap.toFixed(2),
                gananciaNeta: +volTotalPnl.toFixed(2),
                roi: +((volTotalPnl / INITIAL_CAPITAL) * 100).toFixed(2),
                totalTrades: volTrades.length,
                winRate: volWinRate,
                trades: volTrades
            }
        });

    } catch (error) {
        console.error('Backtest error:', error.message);
        res.status(500).json({ error: error.message });
    }
}
