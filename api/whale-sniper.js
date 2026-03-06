import { Connection, PublicKey } from '@solana/web3.js';
import { SniperState } from './whale-sniper-state.js';
import fs from 'fs';

// Caching the connection and last slot to reduce RPC calls
let connection = null;
let lastSlot = 0;
let lastWhalesCache = [];

const getConnection = () => {
    if (!connection) {
        connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    }
    return connection;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const getRecentWhales = async () => {
    try {
        const conn = getConnection();
        const slot = await conn.getSlot();

        // Si ya procesamos este slot o uno menor, saltar para ahorrar RPC calls
        if (slot <= lastSlot) {
            return lastWhalesCache;
        }
        lastSlot = slot;

        const block = await conn.getBlock(slot, {
            maxSupportedTransactionVersion: 0,
            transactionDetails: 'full'
        });

        let whales = [];
        if (block && block.transactions) {
            block.transactions.forEach(t => {
                if (!t.meta) return;
                const diff = (t.meta.preBalances[0] - t.meta.postBalances[0]) / 1e9;

                // 1. Filtro base
                if (diff > 5 && t.meta.postTokenBalances.length > 0) {
                    const signer = t.transaction.message.staticAccountKeys[0].toString();

                    let maxTokenDelta = 0;
                    let bestToken = null;

                    t.meta.postTokenBalances.forEach(post => {
                        if (post.owner === signer) {
                            const pre = t.meta.preTokenBalances.find(p => p.accountIndex === post.accountIndex);
                            const preAmt = pre?.uiTokenAmount.uiAmount || 0;
                            const postAmt = post.uiTokenAmount.uiAmount || 0;
                            const delta = postAmt - preAmt;

                            if (delta > 0 && delta > maxTokenDelta) {
                                maxTokenDelta = delta;
                                bestToken = post.mint;
                            }
                        }
                    });

                    if (!bestToken) {
                        const tokenList = t.meta.postTokenBalances.filter(tb => tb.owner === signer);
                        bestToken = tokenList[tokenList.length - 1]?.mint;
                    }

                    if (bestToken && bestToken !== 'So11111111111111111111111111111111111111112') {
                        whales.push({
                            signature: t.transaction.signatures[0],
                            wallet: signer,
                            amount: diff.toFixed(2),
                            usd: (diff * 142).toFixed(2),
                            time: new Date().toLocaleTimeString(),
                            token: bestToken,
                            tokenDelta: maxTokenDelta
                        });
                    }
                }
            });
        }

        lastWhalesCache = whales.slice(0, 10);
        await SniperState.updateEngine(whales);
        return whales;
    } catch (e) {
        if (e.message.includes('429')) {
            console.warn('⚠️ Solana RPC Rate Limited (429). Waiting longer...');
            await sleep(3000);
        } else {
            console.warn('Solana Scan Error:', e.message);
        }
        await SniperState.updateEngine([]);
        return lastWhalesCache;
    }
};

export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            // Regresamos el CACHE, no disparamos escaneo nuevo desde la UI
            res.json({
                success: true,
                whales: lastWhalesCache.slice(0, 5),
                state: SniperState.get(),
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    }

    if (req.method === 'POST') {
        const { action, payload } = req.body;
        const current = SniperState.get();

        if (action === 'TOGGLE_SNIPER') {
            SniperState.set({ ...current, sniperActive: payload });
        } else if (action === 'UPDATE_CONFIG') {
            SniperState.set({ ...current, ...payload });
        } else if (action === 'CLEAR_HISTORY') {
            SniperState.set({ ...current, history: [] });
        } else if (action === 'CLOSE_TRADE') {
            const trade = current.activeTrades.find(t => t.id === payload.id);
            if (trade) {
                const profitUSD = (trade.stakeAmount * (parseFloat(trade.pnl) / 100)).toFixed(2);
                const closedTrade = {
                    id: Date.now(),
                    whale: trade.whale,
                    amount: trade.amount,
                    pnl: trade.pnl + '%',
                    profitUSD: (parseFloat(profitUSD) >= 0 ? '+' : '') + profitUSD,
                    time: 'Manual/Backend',
                    status: parseFloat(trade.pnl) > 0 ? 'WIN' : 'LOSS'
                };
                SniperState.set({
                    ...current,
                    balance: current.balance + parseFloat(profitUSD),
                    history: [closedTrade, ...current.history.slice(0, 19)],
                    activeTrades: current.activeTrades.filter(t => t.id !== payload.id)
                });
            }
        } else if (action === 'GET_LOGS') {
            const logPath = './sniper_debug.log';
            let content = "No log found.";
            if (fs.existsSync(logPath)) {
                content = fs.readFileSync(logPath, 'utf8');
            }
            return res.json({ success: true, logs: content.split('\n').slice(-50) });
        }

        return res.json({ success: true, state: SniperState.get() });
    }
}
