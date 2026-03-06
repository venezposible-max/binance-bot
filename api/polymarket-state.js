import axios from 'axios';

const state = {
    balance: 1000,
    activeTrades: [],
    history: [],
    hotEvents: [], // NEW: List of events being analyzed
    sniperActive: false,
    stakePercent: 5,
    lastUpdate: Date.now()
};

// --- POLYMARKET UTILS ---

// Detectar desequilibrio masivo en el libro de órdenes
const detectImbalance = (bids, asks) => {
    const totalBidVol = bids.reduce((acc, b) => acc + parseFloat(b.size), 0);
    const totalAskVol = asks.reduce((acc, a) => acc + parseFloat(a.size), 0);

    if (totalBidVol === 0 || totalAskVol === 0) return 0;

    // Devolvemos un ratio de desequilibrio (1 es balanceado, > 2 es mucho interes comprador)
    return totalBidVol / totalAskVol;
};

export const PolymarketState = {
    get: () => state,
    set: (newState) => {
        Object.assign(state, newState);
        state.lastUpdate = Date.now();
    },

    // Motor de búsqueda de oportunidades en Polymarket
    updateEngine: async () => {
        if (!state.sniperActive) return;

        try {
            // 1. Obtener mercados calientes (Elecciones, Cripto, etc)
            // Usamos Gamma API para buscar eventos con volumen
            const gammaUrl = 'https://gamma-api.polymarket.com/events?limit=8&active=true&closed=false';
            const gammaRes = await axios.get(gammaUrl, { timeout: 3000 });
            const events = gammaRes.data;

            // Almacenar eventos calientes para el UI (verificacion de datos reales)
            state.hotEvents = events.slice(0, 5).map(e => ({
                id: e.id,
                title: e.title,
                volume: e.volume || '0',
                price: e.markets?.[0]?.outcomePrices?.[0] || '0.50',
                image: e.image
            }));

            // 2. Analizar cada evento buscando desequilibrios
            for (const event of events) {
                if (state.activeTrades.length >= 3) break;

                const market = event.markets?.[0];
                if (!market || !market.clobTokenIds) continue;

                // Evitamos duplicados
                if (state.activeTrades.some(t => t.marketId === market.id)) continue;

                // 3. Consultar Orderbook (CLOB API)
                // TokenID de la opcion "SÍ" (Yes)
                const yesTokenId = JSON.parse(market.clobTokenIds)[0];
                const bookUrl = `https://clob.polymarket.com/book?token_id=${yesTokenId}`;

                try {
                    const bookRes = await axios.get(bookUrl, { timeout: 2000 });
                    const { bids, asks } = bookRes.data;

                    const ratio = detectImbalance(bids || [], asks || []);

                    // Si hay un desequilibrio masivo (> 3 veces mas compras que ventas)
                    if (ratio > 3.0) {
                        const currentPrice = parseFloat(asks[0]?.price || 0.5);
                        const stakeAmount = state.balance * (state.stakePercent / 100);

                        if (stakeAmount > 0) {
                            state.activeTrades.push({
                                id: Date.now() + Math.random(),
                                marketId: market.id,
                                title: market.question || event.title,
                                outcome: 'YES',
                                entryPrice: currentPrice,
                                currentPrice: currentPrice,
                                pnl: "0.0",
                                stakeAmount,
                                ratio: ratio.toFixed(2),
                                startTime: Date.now()
                            });
                            console.log(`🎯 POLYMARKET SNIPE: ${market.question} | Ratio: ${ratio.toFixed(2)}`);
                        }
                    }
                } catch (e) { }
            }

            // 4. Actualizar PnL de trades activos (Simulacion de mercado real)
            state.activeTrades = state.activeTrades.map(trade => {
                // Simulamos una fluctuacion probabilistica basada en el imbalance original
                const drift = (parseFloat(trade.ratio) > 5 ? 1.5 : 0.8) - 0.5;
                const change = (Math.random() * 2.0 - 0.5) + drift;
                const newPnl = parseFloat(trade.pnl) + change;

                if (newPnl >= 15 || newPnl <= -8) {
                    const profitUSD = (trade.stakeAmount * (newPnl / 100)).toFixed(2);
                    const closedTrade = {
                        id: Date.now() + Math.random(),
                        title: trade.title,
                        pnl: newPnl.toFixed(1) + '%',
                        profitUSD: (parseFloat(profitUSD) >= 0 ? '+' : '') + profitUSD,
                        time: new Date().toLocaleTimeString(),
                        status: newPnl > 0 ? 'WIN' : 'LOSS',
                        type: 'Polymarket'
                    };

                    state.balance += parseFloat(profitUSD);
                    state.history = [closedTrade, ...state.history.slice(0, 19)];
                    return null;
                }
                return { ...trade, pnl: newPnl.toFixed(1) };
            }).filter(Boolean);

        } catch (error) {
            console.error('Polymarket Engine Error:', error.message);
        }
    }
};
