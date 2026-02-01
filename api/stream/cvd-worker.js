import WebSocket from 'ws';

class CVDSniper {
    constructor() {
        this.symbol = 'btcusdt';
        this.ws = null;
        this.cvd = 0;
        this.history = []; // Array of { time, price, cvd, delta }
        this.maxHistory = 1000; // Keep last 1000 ticks for graph
        this.lastPrice = 0;

        // Strategy Parameters
        this.THRESHOLD = 150000; // 150k USDT Delta
        this.isReconnecting = false;

        this.stats = {
            startTime: Date.now(),
            messages: 0,
            triggers: 0
        };

        console.log('🔫 CVD SNIPER: Class Initialized');
        this.connect();
    }

    connect() {
        if (this.ws) return;

        const url = `wss://stream.binance.com:9443/ws/${this.symbol}@aggTrade`;
        console.log(`🔫 CVD SNIPER: Connecting to ${url}...`);

        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
            console.log('🔫 CVD SNIPER: WebSocket Connected! Listening for Whale Movements...');
            this.isReconnecting = false;
        });

        this.ws.on('message', (data) => {
            try {
                this.processTrade(JSON.parse(data));
            } catch (e) {
                console.error('CVD Parse Error:', e);
            }
        });

        this.ws.on('close', () => {
            console.warn('🔫 CVD SNIPER: Disconnected. Reconnecting in 5s...');
            this.ws = null;
            setTimeout(() => this.connect(), 5000);
        });

        this.ws.on('error', (err) => {
            console.error('🔫 CVD SNIPER: WebSocket Error:', err.message);
        });
    }

    processTrade(trade) {
        // trade object structure from Binance aggTrade:
        // { p: 'price', q: 'quantity', m: isBuyerMaker }

        const price = parseFloat(trade.p);
        const qty = parseFloat(trade.q);
        const volume = price * qty;

        this.lastPrice = price;
        this.stats.messages++;

        // Calculate Delta
        // If isBuyerMaker = true -> Sell Order (Maker was Buyer) -> Negative Delta
        // If isBuyerMaker = false -> Buy Order (Maker was Seller) -> Positive Delta
        const delta = trade.m ? -volume : volume;

        this.cvd += delta;

        // Push to History (Throttled slightly to avoid RAM overflow in extreme volatility?)
        // Actually, let's just push every trade. 1000 items is small.
        this.history.push({
            t: trade.T, // Time
            p: price,
            d: delta,
            c: this.cvd
        });

        // Trim History
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }

        // 🎯 SNIPER LOGIC
        if (Math.abs(delta) > this.THRESHOLD) {
            console.log(` WHALE ALERT: ${delta > 0 ? '🟢 BUY' : '🔴 SELL'} POWER: $${Math.abs(delta).toFixed(0)} @ ${price}`);
            this.stats.triggers++;
            // Here we would trigger the Paper Trade
        }
    }

    getData() {
        return {
            symbol: this.symbol.toUpperCase(),
            price: this.lastPrice,
            cvd: this.cvd,
            history: this.history, // Frontend will render this
            stats: this.stats
        };
    }
}

// Singleton Export
const sniper = new CVDSniper();
export default sniper;
