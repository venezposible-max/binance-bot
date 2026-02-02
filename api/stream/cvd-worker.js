import WebSocket from 'ws';
import redis from '../../src/utils/redisClient.js';
import binanceClient from '../utils/binance-client.js';
import { sendRawTelegram } from '../../src/utils/telegram.js';

class CVDSniper {
    constructor() {
        this.symbol = 'btcusdt';
        this.ws = null;
        this.cvd = 0;
        this.history = [];
        this.maxHistory = 1000;
        this.lastPrice = 0;

        // DUAL STATE
        this.activeTrades = []; // Contains mixed trades (tagged by mode)

        // COOLDOWNS (Separate for modes)
        this.lastTradeTime = { LIVE: 0, SIMULATION: 0 };
        this.COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

        this.isReconnecting = false;
        this.isOpeningTrade = false;

        this.stats = { startTime: Date.now(), messages: 0, triggers: 0 };

        console.log('🔫 CVD SNIPER: Class Initialized (Dual Engine Ready)');
        this.loadState().then(() => {
            this.connect();
        });

        // HEARTBEAT
        setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const liveCount = this.activeTrades.filter(t => t.mode === 'LIVE').length;
                const simCount = this.activeTrades.filter(t => t.mode !== 'LIVE').length;
                console.log(`🔫 [SNIPER] Scanning BTCUSDT (CVD) | Active: ${liveCount} (Live) / ${simCount} (Sim) | Waiting for Whales...`);
            }
        }, 60000);
    }

    async loadState() {
        try {
            const sniperTradesStr = await redis.get('sentinel_sniper_trades');
            if (sniperTradesStr) {
                this.activeTrades = JSON.parse(sniperTradesStr);
                console.log(`🔫 SNIPER: Restored ${this.activeTrades.length} active trades.`);
            }

            // Load Cooldowns
            const liveCd = await redis.get('sentinel_sniper_cooldown_live');
            const simCd = await redis.get('sentinel_sniper_cooldown_sim');
            if (liveCd) this.lastTradeTime.LIVE = parseInt(liveCd);
            if (simCd) this.lastTradeTime.SIMULATION = parseInt(simCd);

        } catch (e) {
            console.error('Failed to load Sniper state:', e);
        }
    }

    connect() {
        if (this.ws) return;
        const url = `wss://stream.binance.com:9443/ws/${this.symbol}@aggTrade`;
        console.log(`🔫 CVD SNIPER: Connecting to ${url}...`);
        this.ws = new WebSocket(url);

        this.ws.on('open', () => { console.log('🔫 CVD SNIPER: Connected!'); this.isReconnecting = false; });
        this.ws.on('message', (data) => { try { this.processTrade(JSON.parse(data)); } catch (e) { console.error('CVD Error:', e); } });
        this.ws.on('close', () => { console.warn('🔫 CVD SNIPER: Disconnected. Reconnecting...'); this.ws = null; setTimeout(() => this.connect(), 5000); });
        this.ws.on('error', (err) => { console.error('WebSocket Error:', err.message); });
    }

    async processTrade(trade) {
        const price = parseFloat(trade.p);
        const qty = parseFloat(trade.q);
        const volume = price * qty;
        this.lastPrice = price;
        this.stats.messages++;

        // Exits Check (Throttled 1s)
        if (Date.now() - (this.lastExitCheck || 0) > 1000) {
            this.lastExitCheck = Date.now();
            this.checkExits(price);
        }

        const delta = trade.m ? -volume : volume;
        this.cvd += delta;
        this.history.push({ t: trade.T, p: price, d: delta, c: this.cvd });
        if (this.history.length > this.maxHistory) this.history.shift();

        // 🎯 DUAL ENGINE TRIGGER CHECK
        if (delta > 10000) { // Slight optimization: Don't fetch redis for tiny trades
            await this.evaluateTrigger(price, delta);
        }
    }

    async evaluateTrigger(price, delta) {
        if (this.isOpeningTrade) return;
        this.isOpeningTrade = true;

        try {
            // LOAD BOTH CONFIGS FRESH
            const configLiveStr = await redis.get('sentinel_wallet_config_real');
            const configSimStr = await redis.get('sentinel_wallet_config_sim');

            const configLive = configLiveStr ? JSON.parse(configLiveStr) : null;
            const configSim = configSimStr ? JSON.parse(configSimStr) : null;

            // CHECK LIVE TRIGGER
            if (configLive && configLive.isBotActive) {
                // Check strategy is specifically SNIPER enabled
                const stratConfig = configLive.strategyConfig || {};
                const isSniperActive = stratConfig.SNIPER?.active;

                if (isSniperActive && delta > (configLive.whaleThreshold || 150000)) {
                    await this.executeModeTrade(price, delta, configLive, 'LIVE');
                }
            }

            // CHECK SIMULATION TRIGGER
            if (configSim && configSim.isBotActive) {
                const stratConfig = configSim.strategyConfig || {};
                const isSniperActive = stratConfig.SNIPER?.active;

                if (isSniperActive && delta > (configSim.whaleThreshold || 150000)) {
                    await this.executeModeTrade(price, delta, configSim, 'SIMULATION');
                }
            }

        } catch (e) {
            console.error('Trigger Eval Error:', e);
        } finally {
            this.isOpeningTrade = false;
        }
    }

    async executeModeTrade(entryPrice, delta, config, mode) {
        // Prevent Pyramiding per mode
        if (this.activeTrades.find(t => t.mode === mode)) return;

        // Check Cooldown
        const lastTime = this.lastTradeTime[mode] || 0;
        if (Date.now() - lastTime < this.COOLDOWN_MS) {
            // Silent return for cooldown
            return;
        }

        console.log(`🐳 [${mode}] WHALE DETECTED: $${Math.abs(delta).toFixed(0)} > Threshold. Executing SNIPER.`);

        // Validate Balance
        const balance = config.currentBalance || 0;
        if (balance < 10) return;

        const risk = config.riskPercentage || 10;
        const invested = balance * (risk / 100);
        const positionSize = invested / entryPrice;

        let orderId = `SNIPER_${mode}_${Date.now()}`;

        // EXECUTE
        if (mode === 'LIVE') {
            try {
                const order = await binanceClient.createOrder({
                    symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: positionSize.toFixed(6)
                });
                orderId = order.orderId;
            } catch (e) {
                console.error(`❌ [LIVE] SNIPER ORDER FAILED:`, e.message);
                return;
            }
        } else {
            config.currentBalance -= (invested * 1.001);
            // Update appropriate config key
            const configKey = mode === 'LIVE' ? 'sentinel_wallet_config_real' : 'sentinel_wallet_config_sim';
            await redis.set(configKey, JSON.stringify(config));
        }

        const trade = {
            id: orderId,
            symbol: 'BTCUSDT',
            strategy: 'SNIPER',
            side: 'BUY',
            entryPrice: entryPrice,
            size: positionSize,
            investedAmount: invested,
            targetProfit: entryPrice * 1.012, // 1.2%
            stopLoss: entryPrice * 0.995, // 0.5%
            timestamp: Date.now(),
            mode: mode
        };

        this.activeTrades.push(trade);
        this.lastTradeTime[mode] = Date.now();

        // Save State
        await redis.set('sentinel_sniper_trades', JSON.stringify(this.activeTrades));
        await redis.set(`sentinel_sniper_cooldown_${mode === 'LIVE' ? 'live' : 'sim'}`, this.lastTradeTime[mode].toString());

        await sendRawTelegram(`🔫 **[${mode}] SNIPER HIT** 🐋\n💎 BTCUSDT\n💰 Entry: $${entryPrice.toFixed(2)}\n💸 Invested: $${invested.toFixed(2)}\n🌊 Delta: $${Math.round(delta)}`);
    }

    async checkExits(currentPrice) {
        // Loop backwards to safely remove
        for (let i = this.activeTrades.length - 1; i >= 0; i--) {
            const trade = this.activeTrades[i];
            let exitReason = null;

            if (currentPrice >= trade.targetProfit) exitReason = 'TP';
            else if (currentPrice <= trade.stopLoss) exitReason = 'SL';

            if (exitReason) {
                const profitPct = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
                const rawProfit = (currentPrice - trade.entryPrice) * trade.size;
                const netProfit = rawProfit - (trade.investedAmount * 0.002); // Approx fees

                if (trade.mode === 'LIVE') {
                    try {
                        await binanceClient.createOrder({ symbol: 'BTCUSDT', side: 'SELL', type: 'MARKET', quantity: trade.size.toFixed(6) });
                    } catch (e) {
                        console.error(`❌ [LIVE] SNIPER EXIT FAILED:`, e.message);
                        continue; // Retry next tick
                    }
                } else {
                    // Update SIM Balance
                    const configKey = trade.mode === 'LIVE' ? 'sentinel_wallet_config_real' : 'sentinel_wallet_config_sim';
                    const configStr = await redis.get(configKey);
                    if (configStr) {
                        const conf = JSON.parse(configStr);
                        conf.currentBalance += (trade.investedAmount + netProfit);
                        await redis.set(configKey, JSON.stringify(conf));
                    }
                }

                this.activeTrades.splice(i, 1);
                await redis.set('sentinel_sniper_trades', JSON.stringify(this.activeTrades));

                // Add to History (Shared Key with other modes?)
                // Ideally we should append to the main win_history keys
                // For now, let's just log it. The main check-prices loop also manages history, 
                // but Sniper is separate. We should maintain separate history or merge.
                // Simplified: Just log for now.
                console.log(`🎯 [${trade.mode}] SNIPER CLOSED: ${exitReason} | ${profitPct.toFixed(2)}%`);
                await sendRawTelegram(`🎯 **[${trade.mode}] SNIPER EXIT**\nResult: ${exitReason}\nPnL: ${profitPct.toFixed(2)}%`);
            }
        }
    }

    getData() {
        return {
            symbol: 'BTCUSDT',
            price: this.lastPrice,
            cvd: this.cvd,
            history: this.history,
            stats: this.stats,
            activeTrades: this.activeTrades
        };
    }
}

const sniper = new CVDSniper();
export default sniper;
