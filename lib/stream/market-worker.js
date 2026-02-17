import WebSocket from 'ws';

class MarketWorker {
    constructor() {
        this.symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'BNBUSDT', 'AVAXUSDT', 'LINKUSDT'];
        this.cache = {}; // symbol -> { price, bid, ask, depth }
        this.sockets = {};
        this.isInitialized = false;

        console.log('📡 MARKET WORKER: Initializing Zero-Latency Stream...');
    }

    start() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        // Initialize cache for all symbols
        this.symbols.forEach(s => {
            this.cache[s] = {
                price: 0,
                bid: 0,
                ask: 0,
                depth: { bids: [], asks: [] },
                lastUpdate: 0
            };
            this.connectSymbol(s);
        });
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

        ws.on('close', () => {
            console.warn(`📡 MARKET WORKER: Connection closed for ${symbol}. Reconnecting...`);
            setTimeout(() => this.connectSymbol(symbol), 5000);
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
