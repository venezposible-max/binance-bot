import WebSocket from 'ws';
import redis from '../../src/utils/redisClient.js';
import binanceClient from '../utils/binance-client.js';

class CVDSniper {
    constructor() {
        this.symbol = 'btcusdt';
        this.ws = null;
        this.cvd = 0;
        this.history = []; // Array of { time, price, cvd, delta }
        this.maxHistory = 1000; // Keep last 1000 ticks for graph
        this.lastPrice = 0;
        this.activeTrades = []; // Track active Sniper positions

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

        // Check exits for active trades
        if (this.activeTrades.length > 0) {
            this.checkExits(price);
        }

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

        // 🎯 SNIPER LOGIC: Execute Trade on Whale Detection
        if (delta > this.THRESHOLD) { // Only BUY on positive delta (whale buying)
            console.log(`🐳 WHALE ALERT: BUY POWER: $${Math.abs(delta).toFixed(0)} @ ${price}`);
            this.stats.triggers++;
            this.executeSniperTrade(price);
        }
    }

    async executeSniperTrade(entryPrice) {
        try {
            // Read wallet config
            const configStr = await redis.get('sentinel_wallet_config');
            if (!configStr) {
                console.warn('⚠️ Sniper: No wallet config found');
                return;
            }

            const config = JSON.parse(configStr);

            // Check if bot is active
            if (!config.isBotActive) {
                console.log('🔕 Sniper: Bot is paused');
                return;
            }

            // Check available capital
            const availableBalance = config.currentBalance || 1000;
            if (availableBalance < 10) {
                console.warn('⚠️ Sniper: Insufficient balance');
                return;
            }

            // Calculate position size using riskPercentage (unified with other strategies)
            const riskPercentage = config.riskPercentage || 10; // Default 10%
            const investedAmount = availableBalance * (riskPercentage / 100);
            const positionSize = investedAmount / entryPrice;
            const fee = investedAmount * 0.001; // 0.1% fee

            // Determine if Paper or Live
            const isLive = config.tradingMode === 'LIVE';
            let orderId = `SNIPER_${Date.now()}`;

            if (isLive) {
                // Execute real order
                try {
                    const order = await binanceClient.createOrder({
                        symbol: 'BTCUSDT',
                        side: 'BUY',
                        type: 'MARKET',
                        quantity: positionSize.toFixed(6)
                    });
                    orderId = order.orderId;
                    console.log('✅ LIVE ORDER EXECUTED:', orderId);
                } catch (e) {
                    console.error('❌ Live order failed:', e.message);
                    return;
                }
            }

            // Create trade record
            const trade = {
                id: orderId,
                symbol: 'BTCUSDT',
                strategy: 'SNIPER',
                side: 'BUY',
                entryPrice: entryPrice,
                size: positionSize,
                investedAmount: investedAmount,
                targetProfit: entryPrice * 1.01, // TP: 1%
                stopLoss: entryPrice * 0.995, // SL: 0.5%
                timestamp: Date.now(),
                mode: isLive ? 'LIVE' : 'PAPER'
            };

            // Store in active trades
            this.activeTrades.push(trade);

            // Persist to Redis
            await redis.set('sentinel_sniper_trades', JSON.stringify(this.activeTrades));

            // Update balance (deduct invested amount + fee)
            config.currentBalance -= (investedAmount + fee);
            await redis.set('sentinel_wallet_config', JSON.stringify(config));

            console.log(`🔫 SNIPER TRADE OPENED: ${orderId} @ $${entryPrice} | Invested: $${investedAmount.toFixed(2)} (${riskPercentage}%) | TP: $${trade.targetProfit.toFixed(2)} | SL: $${trade.stopLoss.toFixed(2)}`);

        } catch (e) {
            console.error('❌ Sniper Trade Execution Error:', e.message);
        }
    }

    async checkExits(currentPrice) {
        // Monitor active trades for TP/SL
        for (let i = this.activeTrades.length - 1; i >= 0; i--) {
            const trade = this.activeTrades[i];

            let exitReason = null;
            let exitPrice = currentPrice;

            // Check TP
            if (currentPrice >= trade.targetProfit) {
                exitReason = 'TP (+1.0%)';
            }
            // Check SL
            else if (currentPrice <= trade.stopLoss) {
                exitReason = 'SL (-0.5%)';
            }

            if (exitReason) {
                // Execute exit
                const profit = (exitPrice - trade.entryPrice) * trade.size;
                const fee = exitPrice * trade.size * 0.001;
                const netProfit = profit - fee;

                // Update balance (return invested amount + net profit/loss)
                const configStr = await redis.get('sentinel_wallet_config');
                const config = JSON.parse(configStr);
                config.currentBalance += (trade.investedAmount + netProfit);
                await redis.set('sentinel_wallet_config', JSON.stringify(config));

                console.log(`🎯 SNIPER EXIT: ${trade.id} | ${exitReason} | PnL: $${netProfit.toFixed(2)}`);

                // Remove from active
                this.activeTrades.splice(i, 1);
                await redis.set('sentinel_sniper_trades', JSON.stringify(this.activeTrades));
            }
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
