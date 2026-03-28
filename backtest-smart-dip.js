import axios from 'axios';
import { RSI } from 'technicalindicators';

// ============================================================
// 🧪 BACKTEST: HYBRID SMART DIP (Spot - Top Coins)
// Estrategia: Comprar cuando cae ≥3% del máximo 24h + RSI < 35
// Salida: Trailing desde +2%, lock en +1.5%
// Datos: Últimos 7 días, velas 1H, Top 20 coins
// ============================================================

const TRADING_FEE = 0.001; // 0.1% Binance fee
const DIP_THRESHOLD = -3.0; // Comprar cuando cae 3% del máximo 24h
const RSI_ENTRY = 35;       // RSI debe estar debajo de esto
const RSI_PERIOD = 14;
const TRAILING_START = 2.0;  // Activar trailing al +2%
const TRAILING_LOCK = 1.5;   // Proteger mínimo +1.5%
const EMERGENCY_SL = -5.0;   // SL de emergencia (muy amplio para spot)
const TIMEOUT_HOURS = 48;    // Cerrar si lleva 48h sin resultado
const INITIAL_CAPITAL = 60;
const RISK_PER_TRADE = 33;   // % del capital por trade (3 slots = 33% cada uno)
const MAX_SIMULTANEOUS = 3;

async function getTop20Symbols() {
    const res = await axios.get('https://api1.binance.com/api/v3/ticker/24hr', { timeout: 15000 });
    const BLACKLIST = ['USDC','FDUSD','TUSD','BUSD','DAI','USDP','PAXG','WBTC','USD1','USDE','PEPE','NEAR'];
    
    const relevant = res.data.filter(p => {
        if (!p.symbol.endsWith('USDT')) return false;
        const base = p.symbol.replace('USDT', '');
        if (BLACKLIST.includes(base)) return false;
        return parseFloat(p.quoteVolume) > 10000000; // Solo coins con >$10M vol diario
    });
    
    relevant.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
    return relevant.slice(0, 20).map(p => p.symbol);
}

async function fetchKlines(symbol, interval, limit) {
    try {
        const res = await axios.get(`https://api1.binance.com/api/v3/klines`, {
            params: { symbol, interval, limit },
            timeout: 15000
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

async function runBacktest() {
    console.log('');
    console.log('='.repeat(65));
    console.log('🧪 BACKTEST: HYBRID SMART DIP vs VOLCANO');
    console.log('📅 Período: Últimos 30 días | Velas: 1H | Top 20 Coins');
    console.log(`💰 Capital: $${INITIAL_CAPITAL} | Risk: ${RISK_PER_TRADE}% por trade`);
    console.log(`📉 Entrada: Dip ≥${Math.abs(DIP_THRESHOLD)}% + RSI < ${RSI_ENTRY}`);
    console.log(`📈 Salida: Trailing +${TRAILING_START}% → Lock +${TRAILING_LOCK}%`);
    console.log('='.repeat(65));

    const symbols = await getTop20Symbols();
    console.log(`\n📊 Coins: ${symbols.join(', ')}\n`);

    // ========== SMART DIP STRATEGY ==========
    let dipCapital = INITIAL_CAPITAL;
    const dipTrades = [];
    const dipActiveTrades = [];

    // ========== VOLCANO STRATEGY (for comparison) ==========
    let volCapital = INITIAL_CAPITAL;
    const volTrades = [];

    // Load all data
    const allData = {};
    for (const symbol of symbols) {
        process.stdout.write(`⏳ Cargando ${symbol}...   \r`);
        const klines = await fetchKlines(symbol, '1h', 720); // 30 days
        if (klines.length < 50) continue;
        allData[symbol] = klines;
        await new Promise(r => setTimeout(r, 100)); // Rate limit respect
    }
    console.log(`\n✅ Datos cargados: ${Object.keys(allData).length} coins\n`);

    // ============ SIMULATE SMART DIP ============
    // Build unified timeline
    const timeline = [];
    for (const [symbol, klines] of Object.entries(allData)) {
        klines.forEach((k, idx) => {
            if (idx < 25) return; // Need history for RSI + 24h high
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

            // Update watermark
            if (currentPrice > trade.highWatermark) {
                trade.highWatermark = currentPrice;
            }

            const fromPeak = ((currentPrice - trade.highWatermark) / trade.highWatermark) * 100;

            let exitReason = null;

            // 1. Trailing activated and SL hit
            if (pnl >= TRAILING_START) {
                trade.trailingActive = true;
            }
            if (trade.trailingActive && pnl <= TRAILING_LOCK) {
                exitReason = 'TRAILING_LOCK';
            }

            // 2. Emergency SL
            if (pnl <= EMERGENCY_SL) {
                exitReason = 'EMERGENCY_SL';
            }

            // 3. Timeout
            if (hoursHeld >= TIMEOUT_HOURS && pnl > -1) {
                exitReason = 'TIMEOUT_BREAKEVEN';
            }

            if (exitReason) {
                const grossReturn = (currentPrice / trade.entryPrice) * trade.invested;
                const netReturn = grossReturn * (1 - TRADING_FEE);
                const profit = netReturn - trade.invested;
                dipCapital += netReturn;

                dipTrades.push({
                    symbol,
                    entry: trade.entryPrice,
                    exit: currentPrice,
                    pnlPct: pnl,
                    pnlUsd: profit,
                    reason: exitReason,
                    hoursHeld: hoursHeld,
                    rsiAtEntry: trade.rsiAtEntry,
                    dipPct: trade.dipPct
                });

                dipActiveTrades.splice(i, 1);
            }
        }

        // --- CHECK ENTRY ---
        if (dipActiveTrades.length >= MAX_SIMULTANEOUS) continue;
        if (dipActiveTrades.find(t => t.symbol === symbol)) continue;
        if (dipCapital < 5) continue;

        // Calculate 24h high (24 candles back on 1h)
        const lookback = klines.slice(Math.max(0, idx - 24), idx);
        const high24h = Math.max(...lookback.map(k => k.high));

        // Calculate dip from 24h high
        const dipFromHigh = ((currentPrice - high24h) / high24h) * 100;

        // Calculate RSI
        const closesForRSI = klines.slice(0, idx + 1).map(k => k.close);
        const rsiValues = RSI.calculate({ values: closesForRSI, period: RSI_PERIOD });
        const currentRSI = rsiValues[rsiValues.length - 1];

        if (dipFromHigh <= DIP_THRESHOLD && currentRSI && currentRSI < RSI_ENTRY) {
            const investAmount = Math.min(dipCapital, (dipCapital * RISK_PER_TRADE / 100));
            const afterFee = investAmount * (1 - TRADING_FEE);

            dipActiveTrades.push({
                symbol,
                entryPrice: currentPrice,
                invested: afterFee,
                entryTime: currentTime,
                highWatermark: currentPrice,
                trailingActive: false,
                rsiAtEntry: currentRSI.toFixed(1),
                dipPct: dipFromHigh.toFixed(1)
            });

            dipCapital -= investAmount;
        }
    }

    // Close remaining active trades at last known price
    for (const trade of dipActiveTrades) {
        const lastKline = allData[trade.symbol]?.[allData[trade.symbol].length - 1];
        if (lastKline) {
            const currentPrice = lastKline.close;
            const pnl = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
            const grossReturn = (currentPrice / trade.entryPrice) * trade.invested;
            const netReturn = grossReturn * (1 - TRADING_FEE);
            dipCapital += netReturn;
            dipTrades.push({
                symbol: trade.symbol,
                entry: trade.entryPrice,
                exit: currentPrice,
                pnlPct: pnl,
                pnlUsd: netReturn - trade.invested,
                reason: 'STILL_OPEN',
                hoursHeld: 0,
                rsiAtEntry: trade.rsiAtEntry,
                dipPct: trade.dipPct
            });
        }
    }

    // ============ SIMULATE VOLCANO (simplified) ============
    // Same data, but using squeeze + volume breakout logic
    let volActive = null;
    let volCap = INITIAL_CAPITAL;

    for (const [symbol, klines] of Object.entries(allData)) {
        // Use 5m-equivalent approximation on 1h data (less granular but fair comparison)
        for (let i = 25; i < klines.length; i++) {
            const currentPrice = klines[i].close;

            // Check exit
            if (volActive && volActive.symbol === symbol) {
                const pnl = ((currentPrice - volActive.entryPrice) / volActive.entryPrice) * 100;
                if (currentPrice > volActive.highWatermark) volActive.highWatermark = currentPrice;

                // Volcano exit: trailing 1.5% from peak, only in profit
                const trailingLine = volActive.highWatermark * (1 - 0.015);
                if (currentPrice <= trailingLine && currentPrice > volActive.entryPrice) {
                    const gross = (currentPrice / volActive.entryPrice) * volActive.invested;
                    const net = gross * (1 - TRADING_FEE);
                    volCap += net;
                    volTrades.push({
                        symbol,
                        pnlPct: pnl,
                        pnlUsd: net - volActive.invested,
                        reason: 'TRAILING'
                    });
                    volActive = null;
                }
            }

            // Check entry (volcano: squeeze + volume)
            if (!volActive && volCap >= 10) {
                const prev = klines.slice(i - 24, i);
                const maxH = Math.max(...prev.map(k => k.high));
                const minL = Math.min(...prev.map(k => k.low));
                const range = minL > 0 ? ((maxH - minL) / minL) * 100 : 99;

                const prevVols = klines.slice(i - 20, i).map(k => k.volume);
                const avgVol = prevVols.reduce((a, b) => a + b, 0) / prevVols.length;
                const volRatio = avgVol > 0 ? klines[i].volume / avgVol : 0;

                const isSqueeze = range <= 2.5;
                const isVolExplosion = volRatio >= 3.0;
                const isBreakout = currentPrice > maxH;

                if (isSqueeze && isVolExplosion && isBreakout) {
                    volActive = {
                        symbol,
                        entryPrice: currentPrice,
                        invested: volCap * (1 - TRADING_FEE),
                        highWatermark: currentPrice
                    };
                    volCap = 0;
                }
            }
        }
    }
    // Close remaining volcano trade
    if (volActive) {
        const lastK = allData[volActive.symbol]?.[allData[volActive.symbol].length - 1];
        if (lastK) {
            const pnl = ((lastK.close - volActive.entryPrice) / volActive.entryPrice) * 100;
            volCap += volActive.invested * (1 + pnl / 100) * (1 - TRADING_FEE);
            volTrades.push({ symbol: volActive.symbol, pnlPct: pnl, pnlUsd: (volActive.invested * pnl / 100), reason: 'STILL_OPEN' });
        }
    }

    // ============ RESULTS ============
    console.log('='.repeat(65));
    console.log('🏆 RESULTADOS: SMART DIP');
    console.log('='.repeat(65));

    const dipWins = dipTrades.filter(t => t.pnlUsd > 0).length;
    const dipLosses = dipTrades.filter(t => t.pnlUsd <= 0).length;
    const dipTotalPnl = dipTrades.reduce((acc, t) => acc + t.pnlUsd, 0);
    const dipWinRate = dipTrades.length > 0 ? (dipWins / dipTrades.length * 100) : 0;
    const dipAvgWin = dipWins > 0 ? dipTrades.filter(t => t.pnlUsd > 0).reduce((a, t) => a + t.pnlPct, 0) / dipWins : 0;
    const dipAvgLoss = dipLosses > 0 ? dipTrades.filter(t => t.pnlUsd <= 0).reduce((a, t) => a + t.pnlPct, 0) / dipLosses : 0;

    console.log(`💰 Capital Inicial: $${INITIAL_CAPITAL}`);
    console.log(`💵 Capital Final:   $${dipCapital.toFixed(2)}`);
    console.log(`📈 Ganancia Neta:   $${dipTotalPnl.toFixed(2)} (${(dipTotalPnl / INITIAL_CAPITAL * 100).toFixed(2)}%)`);
    console.log(`🤝 Total Trades:    ${dipTrades.length}`);
    console.log(`✅ Ganadores:       ${dipWins}`);
    console.log(`❌ Perdedores:      ${dipLosses}`);
    console.log(`🎯 WIN RATE:        ${dipWinRate.toFixed(1)}%`);
    console.log(`📊 Avg Win:         +${dipAvgWin.toFixed(2)}%`);
    console.log(`📉 Avg Loss:        ${dipAvgLoss.toFixed(2)}%`);
    console.log('');

    if (dipTrades.length > 0) {
        console.log('📋 Detalle de trades:');
        dipTrades.forEach((t, i) => {
            const emoji = t.pnlUsd > 0 ? '🟢' : '🔴';
            console.log(`  ${emoji} ${t.symbol.padEnd(12)} | Entry: $${t.entry.toFixed(4)} → Exit: $${t.exit.toFixed(4)} | PnL: ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}% ($${t.pnlUsd.toFixed(2)}) | RSI: ${t.rsiAtEntry} | Dip: ${t.dipPct}% | ${t.reason}`);
        });
    }

    console.log('');
    console.log('='.repeat(65));
    console.log('🌋 RESULTADOS: VOLCANO (Comparación)');
    console.log('='.repeat(65));

    const volWins = volTrades.filter(t => t.pnlUsd > 0).length;
    const volTotalPnl = volTrades.reduce((acc, t) => acc + t.pnlUsd, 0);
    const volWinRate = volTrades.length > 0 ? (volWins / volTrades.length * 100) : 0;

    console.log(`💰 Capital Inicial: $${INITIAL_CAPITAL}`);
    console.log(`💵 Capital Final:   $${volCap.toFixed(2)}`);
    console.log(`📈 Ganancia Neta:   $${volTotalPnl.toFixed(2)} (${(volTotalPnl / INITIAL_CAPITAL * 100).toFixed(2)}%)`);
    console.log(`🤝 Total Trades:    ${volTrades.length}`);
    console.log(`🎯 WIN RATE:        ${volWinRate.toFixed(1)}%`);

    console.log('');
    console.log('='.repeat(65));
    console.log('⚔️ COMPARACIÓN DIRECTA');
    console.log('='.repeat(65));
    console.log(`${'Métrica'.padEnd(20)} | ${'Smart Dip'.padEnd(15)} | ${'Volcano'.padEnd(15)}`);
    console.log('-'.repeat(55));
    console.log(`${'Win Rate'.padEnd(20)} | ${(dipWinRate.toFixed(1) + '%').padEnd(15)} | ${(volWinRate.toFixed(1) + '%').padEnd(15)}`);
    console.log(`${'Total Trades'.padEnd(20)} | ${String(dipTrades.length).padEnd(15)} | ${String(volTrades.length).padEnd(15)}`);
    console.log(`${'Ganancia Neta'.padEnd(20)} | ${'$' + dipTotalPnl.toFixed(2).padEnd(14)} | ${'$' + volTotalPnl.toFixed(2).padEnd(14)}`);
    console.log(`${'Capital Final'.padEnd(20)} | ${'$' + dipCapital.toFixed(2).padEnd(14)} | ${'$' + volCap.toFixed(2).padEnd(14)}`);
    console.log(`${'ROI'.padEnd(20)} | ${((dipTotalPnl / INITIAL_CAPITAL * 100).toFixed(2) + '%').padEnd(15)} | ${((volTotalPnl / INITIAL_CAPITAL * 100).toFixed(2) + '%').padEnd(15)}`);
    console.log('='.repeat(65));
}

runBacktest().catch(e => console.error('Backtest error:', e.message));
