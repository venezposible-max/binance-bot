import axios from 'axios';
import fs from 'fs';
import path from 'path';

const STATE_FILE = path.join(process.cwd(), 'sniper_state.json');

const loadState = () => {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("Error loading sniper state:", e);
    }
    return {
        balance: 1000,
        activeTrades: [],
        history: [],
        sniperActive: false,
        stakePercent: 10,
        minWhaleSol: 10,
        lastUpdate: Date.now()
    };
};

const saveState = (s) => {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
    } catch (e) {
        console.error("Error saving sniper state:", e);
    }
};

const state = loadState();

// --- UTILS (RUGCHECK & REAL PRICES) ---

const checkRug = async (token) => {
    try {
        console.log(`🛡️ ANALIZANDO SEGURIDAD REAL: ${token}...`);
        const url = `https://api.rugcheck.xyz/v1/tokens/${token}/report`;
        const res = await axios.get(url, { timeout: 10000 });
        const report = res.data;
        const score = report?.score || 0;
        const risks = report?.risks || [];

        const explicitlyRugged = risks.some(r => r.name.toLowerCase().includes('rugged'));
        // MODO AGRESIVO: Hemos subido el umbral a 20,000 para entrar a casi todo excepto lo confirmado como Rugged.
        const isSafe = score < 20000 && !explicitlyRugged;

        console.log(`✅ REPORTE: Score ${score} | Seguro: ${isSafe} | Token: ${token}`);
        return isSafe;
    } catch (e) {
        console.warn(`⚠️ RugCheck ocupado/error. Autopermitido para no perder gema.`);
        return true;
    }
};

const getJupiterPrices = async (tokens) => {
    try {
        const uniqueTokens = [...new Set(tokens.filter(t => t && t !== 'So11111111111111111111111111111111111111112'))];
        if (uniqueTokens.length === 0) return {};

        const url = `https://api.jup.ag/price/v2?ids=${uniqueTokens.join(',')}`;
        const res = await axios.get(url, { timeout: 5000 });

        const prices = {};
        uniqueTokens.forEach(t => {
            const p = res.data?.data?.[t]?.price;
            if (p) prices[t] = parseFloat(p);
        });
        return prices;
    } catch (e) {
        if (e.response?.status === 429) {
            console.warn("⚠️ Jupiter Rate Limited. Cooling down...");
        }
        return {};
    }
};

const LOG_FILE = path.join(process.cwd(), 'sniper_debug.log');
const log = (msg) => {
    try {
        const time = new Date().toISOString();
        const line = `[${time}] ${msg}\n`;
        fs.appendFileSync(LOG_FILE, line);
    } catch (e) { }
    console.log(msg);
};

export const SniperState = {
    get: () => state,
    set: (newState) => {
        Object.assign(state, newState);
        state.lastUpdate = Date.now();
        saveState(state);
    },

    updateEngine: async (newWhales = []) => {
        if (!state.sniperActive) {
            if (newWhales.length > 0) log(`⏩ WHALES IGNORED: Sniper OFF.`);
            return;
        }

        log(`🔎 ENGINE SCAN: ${newWhales.length} signals | ${state.activeTrades.length} active.`);

        // 1. Recopilar todos los tokens para un solo pedido de precio (BATCH)
        const allTokens = [
            ...state.activeTrades.map(t => t.token),
            ...newWhales.map(w => w.token)
        ];
        const prices = await getJupiterPrices(allTokens);

        // 2. Actualizar Trades Activos
        for (let j = 0; j < state.activeTrades.length; j++) {
            const trade = state.activeTrades[j];
            const currentPrice = prices[trade.token];

            if (currentPrice && trade.entryPrice) {
                const newPnl = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
                trade.pnl = newPnl.toFixed(1);
                log(`📈 Trade ${trade.id} (${trade.token}): $${currentPrice.toFixed(6)} | Pnl: ${trade.pnl}%`);

                if (newPnl >= 10 || newPnl <= -5) {
                    log(`🎯 CLOSING TRADE ${trade.id}: Pnl ${newPnl}%`);
                    const profitUSD = (trade.stakeAmount * (newPnl / 100)).toFixed(2);
                    state.balance += parseFloat(profitUSD);
                    state.history = [{
                        id: Date.now(),
                        whale: trade.whale,
                        token: trade.token,
                        amount: trade.amount,
                        pnl: trade.pnl + '%',
                        profitUSD: (parseFloat(profitUSD) >= 0 ? '+' : '') + profitUSD,
                        time: new Date().toLocaleTimeString(),
                        status: newPnl > 0 ? 'WIN' : 'LOSS'
                    }, ...state.history.slice(0, 19)];
                    state.activeTrades.splice(j, 1);
                    j--;
                }
            } else {
                // Pequeña simulación de movimiento si no hay precio real aún
                const drift = (Math.random() * 0.4 - 0.2);
                trade.pnl = (parseFloat(trade.pnl || 0) + drift).toFixed(1);
            }
        }

        // 3. Comprar Ballenas (SNIPE)
        if (newWhales.length > 0 && state.activeTrades.length < 5) {
            for (const whale of newWhales) {
                if (state.activeTrades.length >= 5) {
                    log(`⚠️ MAX TRADES (5). Skipping ${whale.signature}`);
                    break;
                }

                const alreadyIn = state.activeTrades.some(t => t.token === whale.token);
                if (alreadyIn) continue;

                const minSol = state.minWhaleSol || 10;
                if (parseFloat(whale.amount) < minSol) continue;

                log(`🛡️ EVALUATING: ${whale.token} (Whale: ${whale.wallet.substring(0, 8)}...)`);

                // Delay para RugCheck
                await new Promise(r => setTimeout(r, 1000));

                const isSafe = await checkRug(whale.token);
                if (isSafe) {
                    const solPrice = 142;
                    let entryPrice = prices[whale.token];

                    if (!entryPrice && whale.tokenDelta > 0) {
                        entryPrice = (parseFloat(whale.amount) / whale.tokenDelta) * solPrice;
                        log(`🧪 IMPLIED PRICE: $${entryPrice.toFixed(8)} for ${whale.token}`);
                    }

                    if (!entryPrice) {
                        log(`❌ PRICE FAILED: Skipping ${whale.token}`);
                        continue;
                    }

                    const stakeAmount = state.balance * (state.stakePercent / 100);
                    if (stakeAmount >= 1) {
                        state.activeTrades.push({
                            id: Date.now() + Math.random(),
                            sig: whale.signature,
                            whale: whale.wallet.substring(0, 8) + '...',
                            amount: whale.amount + ' SOL',
                            stakeAmount: stakeAmount,
                            pnl: "0.0",
                            token: whale.token,
                            entryPrice: entryPrice,
                            startTime: Date.now()
                        });
                        log(`🚀 BOUGHT ${whale.token} @ $${entryPrice.toFixed(8)}`);
                    }
                } else {
                    log(`❌ unsafe: RugCheck blocked ${whale.token}`);
                }
            }
        }
        saveState(state);
    }
};
