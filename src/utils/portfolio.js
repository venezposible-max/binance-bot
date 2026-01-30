// Helper to handle simulated trades
export const getStoredTrades = () => {
    const trades = localStorage.getItem('sentinel_trades');
    return trades ? JSON.parse(trades) : [];
};

export const saveTrade = (symbol, price, type = 'LONG') => {
    const trades = getStoredTrades();
    const newTrade = {
        id: Date.now(),
        symbol,
        entryPrice: price,
        type, // 'LONG' or 'SHORT'
        timestamp: new Date().toISOString(),
        status: 'OPEN'
    };
    const updated = [...trades, newTrade];
    localStorage.setItem('sentinel_trades', JSON.stringify(updated));
    return updated;
};

export const closeTrade = (tradeId) => {
    const trades = getStoredTrades();
    const updated = trades.filter(t => t.id !== tradeId);
    localStorage.setItem('sentinel_trades', JSON.stringify(updated));
    return updated;
};
