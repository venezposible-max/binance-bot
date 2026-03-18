import WebSocket from 'ws';

class MarketWorker {
    constructor() {
        this.symbols = [];
        this.cache = {}; // symbol -> { price, bid, ask, depth }
        this.sockets = {};
        this.isInitialized = false;
        this.isBanned = false; // Flag to stop spamming if banned
        this.banExpiration = 0;
        this.checkBanStatus(); // Initial check

        console.log('📡 MARKET WORKER: Initializing Dynamic Stream...');
    }

    async checkBanStatus() {
        try {
            const redis = (await import('../utils/redisClient.js')).default;
            const banned = await redis.get('sentinel_rest_banned');
            if (banned === 'true') {
                this.isBanned = true;
                this.banExpiration = Date.now() + 600000; // Assume 10 min if found in redis
                console.warn('📡 MARKET WORKER: IP is marked as BANNED in Redis.');
            }
        } catch (e) { }
    }

    // Add a helper to check ban with auto-recovery
    get activeBan() {
        if (this.isBanned && Date.now() > this.banExpiration && this.banExpiration > 0) {
            this.isBanned = false;
            this.banExpiration = 0;
            return false;
        }
        return this.isBanned;
    }

    updateSymbols(newSymbols) {
        if (!Array.isArray(newSymbols)) return;
        const toAdd = newSymbols.filter(s => !this.symbols.includes(s));
        const toRemove = this.symbols.filter(s => !newSymbols.includes(s));

        toAdd.forEach(s => {
            if (!this.cache[s]) {
                this.cache[s] = { price: 0, bid: 0, ask: 0, depth: { bids: [], asks: [] }, lastUpdate: 0 };
            }
            this.connectSymbol(s);
        });

        toRemove.forEach(s => {
            if (this.sockets[s]) {
                this.sockets[s].close();
                delete this.sockets[s];
            }
        });

        this.symbols = [...newSymbols];
        if (toAdd.length > 0 || toRemove.length > 0) {
            console.log(`📡 MARKET WORKER: Symbols Updated. Monitoring ${this.symbols.length} pairs.`);
        }
    }

    start() {
        // Initialization handled by first updateSymbols or default
        this.isInitialized = true;
    }

    connectSymbol(symbol) {
        const s = symbol.toLowerCase();
        // We use combined streams: BookTicker (real-time price) + Depth20 (order book)
        const url = `wss://stream.binance.com:9443/ws/${s}@bookTicker/${s}@depth20@100ms`;

        const ws = new WebSocket(url);

        ws.on('open', () => {
            console.log(`📡 MARKET WORKER: Connected to ${symbol} WebSocket`);
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                this.updateCache(symbol, msg);
            } catch (e) {
                console.error(`Error parsing ${symbol} WS message:`, e.message);
            }
        });

        ws.on('error', (err) => {
            console.error(`📡 MARKET WORKER: Error on ${symbol} socket:`, err.message);
        });

        ws.on('close', (code) => {
            if (this.sockets[symbol]) {
                const delay = this.isBanned ? 60000 : 5000;
                setTimeout(() => {
                    if (this.symbols.includes(symbol)) this.connectSymbol(symbol);
                }, delay);
            }
        });

        this.sockets[symbol] = ws;
    }

    updateCache(symbol, msg) {
        const item = this.cache[symbol];

        // Handle BookTicker (u: update_id, s: symbol, b: bid_price, B: bid_qty, a: ask_price, A: ask_qty)
        if (msg.b && msg.a) {
            item.bid = parseFloat(msg.b);
            item.ask = parseFloat(msg.a);
            item.price = (item.bid + item.ask) / 2;
            item.lastUpdate = Date.now();
        }
        // Handle Depth20 (lastUpdateId, bids: [[p, q]], asks: [[p, q]])
        else if (msg.bids && msg.asks) {
            item.depth = {
                bids: msg.bids,
                asks: msg.asks
            };
            item.lastUpdate = Date.now();
        }
    }

    getMarketData(symbol) {
        return this.cache[symbol] || null;
    }

    getAllMarketData() {
        return this.cache;
    }
}

// Singleton Instance
const marketWorker = new MarketWorker();
export default marketWorker;
