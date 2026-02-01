import redis from '../../src/utils/redisClient.js';

export default async function handler(req, res) {
    try {
        // Get wallet config
        const configStr = await redis.get('sentinel_wallet_config');
        const config = configStr ? JSON.parse(configStr) : null;

        // Get sniper trades
        const sniperTradesStr = await redis.get('sentinel_sniper_trades');
        const sniperTrades = sniperTradesStr ? JSON.parse(sniperTradesStr) : [];

        // Get regular trades
        const activeTradesStr = await redis.get('sentinel_active_trades');
        const activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];

        res.status(200).json({
            wallet: config,
            sniperTrades: sniperTrades,
            regularTrades: activeTrades,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
