import { PolymarketState } from './polymarket-state.js';

export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            // Sincronizar motor de imbalance
            await PolymarketState.updateEngine();

            res.json({
                success: true,
                state: PolymarketState.get(),
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Polymarket API Error:', error.message);
            res.status(500).json({ success: false, error: 'Polymarket API Error' });
        }
    }

    if (req.method === 'POST') {
        const { action, payload } = req.body;
        const current = PolymarketState.get();

        if (action === 'TOGGLE_SNIPER') {
            PolymarketState.set({ ...current, sniperActive: payload });
        } else if (action === 'UPDATE_CONFIG') {
            PolymarketState.set({ ...current, ...payload });
        } else if (action === 'CLEAR_HISTORY') {
            PolymarketState.set({ ...current, history: [] });
        } else if (action === 'CLOSE_TRADE') {
            const trade = current.activeTrades.find(t => t.id === payload.id);
            if (trade) {
                const profitUSD = (trade.stakeAmount * (parseFloat(trade.pnl) / 100)).toFixed(2);
                const closedTrade = {
                    id: Date.now(),
                    title: trade.title,
                    pnl: trade.pnl + '%',
                    profitUSD: (parseFloat(profitUSD) >= 0 ? '+' : '') + profitUSD,
                    time: 'Manual/Polymarket',
                    status: parseFloat(trade.pnl) > 0 ? 'WIN' : 'LOSS'
                };
                PolymarketState.set({
                    ...current,
                    balance: current.balance + parseFloat(profitUSD),
                    history: [closedTrade, ...current.history.slice(0, 19)],
                    activeTrades: current.activeTrades.filter(t => t.id !== payload.id)
                });
            }
        }

        return res.json({ success: true, state: PolymarketState.get() });
    }
}
