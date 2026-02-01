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
        this.lastTradeTime = 0; // Cooldown tracker
        this.COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

        // Strategy Parameters
        this.THRESHOLD = 150000; // 150k USDT Delta
        this.isReconnecting = false;

        this.stats = {
            startTime: Date.now(),
            messages: 0,
            triggers: 0
        };

        this.isOpeningTrade = false; // Lock to prevent race conditions

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
        if (this.isOpeningTrade) return;
        this.isOpeningTrade = true;

        try {
            // SYNC: Read current active sniper trades from Redis to ensure we don't double-open
            const sniperTradesStr = await redis.get('sentinel_sniper_trades');
            const currentActive = sniperTradesStr ? JSON.parse(sniperTradesStr) : [];

            // Read wallet config
            const configStr = await redis.get('sentinel_wallet_config');
            if (!configStr) {
                console.warn('⚠️ Sniper: No wallet config found');
                this.isOpeningTrade = false;
                return;
            }

            const config = JSON.parse(configStr);

            // Check if bot is active
            if (!config.isBotActive) {
                console.log('🔕 Sniper: Bot is paused');
                this.isOpeningTrade = false;
                return;
            }

            // Prevent multiple active trades (checking both memory and Redis sync)
            if (currentActive.length > 0) {
                console.log('🔫 Sniper: Already have an active trade');
                this.isOpeningTrade = false;
                return;
            }
            this.activeTrades = currentActive; // Update in-memory active trades

            // Check cooldown (prevent reopening immediately after close)
            const cooldownStr = await redis.get('sentinel_sniper_cooldown');
            const lastCooldownTime = cooldownStr ? parseInt(cooldownStr) : this.lastTradeTime;

            const now = Date.now();
            if (now - lastCooldownTime < this.COOLDOWN_MS) {
                const remaining = Math.ceil((this.COOLDOWN_MS - (now - lastCooldownTime)) / 1000);
                console.log(`⏳ Sniper: Cooldown active (${remaining}s remaining)`);
                this.isOpeningTrade = false;
                return;
            }

            // Check available capital
            const availableBalance = config.currentBalance || 1000;
            if (availableBalance < 10) {
                console.warn('⚠️ Sniper: Insufficient balance');
                this.isOpeningTrade = false;
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
            console.log(`💰 BEFORE: Balance = $${config.currentBalance.toFixed(2)} | Deducting: $${(investedAmount + fee).toFixed(2)}`);
            config.currentBalance -= (investedAmount + fee);
            console.log(`💰 AFTER: Balance = $${config.currentBalance.toFixed(2)}`);
            await redis.set('sentinel_wallet_config', JSON.stringify(config));

            // Update cooldown tracker (both in-memory and Redis)
            this.lastTradeTime = Date.now();
            await redis.set('sentinel_sniper_cooldown', this.lastTradeTime.toString());


            console.log(`🔫 SNIPER TRADE OPENED: ${orderId} @ $${entryPrice} | Invested: $${investedAmount.toFixed(2)} (${riskPercentage}%) | TP: $${trade.targetProfit.toFixed(2)} | SL: $${trade.stopLoss.toFixed(2)}`);

        } catch (e) {
            console.error('❌ Sniper Trade Execution Error:', e.message);
        } finally {
            this.isOpeningTrade = false;
        }
    }

    async checkExits(currentPrice) {
        // SYNC: Read current active sniper trades from Redis before checking
        const sniperTradesStr = await redis.get('sentinel_sniper_trades');
        this.activeTrades = sniperTradesStr ? JSON.parse(sniperTradesStr) : [];

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
                const grossProfit = (exitPrice - trade.entryPrice) * trade.size;
                const exitFee = exitPrice * trade.size * 0.001;
                const entryFee = trade.investedAmount * 0.001; // Re-calculate entry fee paid
                const totalFees = exitFee + entryFee;
                const netProfit = grossProfit - exitFee; // This is the amount relative to investedAmount to add back to balance
                const totalCycleProfit = grossProfit - totalFees; // Actual PnL for history

                const pnlPercent = (totalCycleProfit / trade.investedAmount) * 100;

                // Update balance (return invested amount + net profit/loss)
                const configStr = await redis.get('sentinel_wallet_config');
                const config = JSON.parse(configStr);
                config.currentBalance += (trade.investedAmount + netProfit);
                await redis.set('sentinel_wallet_config', JSON.stringify(config));

                // Move to history
                const historyStr = await redis.get('sentinel_win_history');
                const history = historyStr ? JSON.parse(historyStr) : [];

                history.unshift({
                    id: trade.id,
                    symbol: trade.symbol,
                    type: 'LONG',
                    strategy: 'SNIPER',
                    entryPrice: trade.entryPrice,
                    exitPrice: exitPrice,
                    investedAmount: trade.investedAmount || 0,
                    pnl: pnlPercent,
                    profitUsd: totalCycleProfit, // Unified field name
                    timestamp: trade.timestamp,
                    closeTime: Date.now(),
                    reason: exitReason
                });

                // Keep last 50 trades
                if (history.length > 50) history.pop();
                await redis.set('sentinel_win_history', JSON.stringify(history));

                console.log(`🎯 SNIPER EXIT: ${trade.id} | ${exitReason} | PnL: ${pnlPercent.toFixed(2)}% ($${netProfit.toFixed(2)})`);

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
