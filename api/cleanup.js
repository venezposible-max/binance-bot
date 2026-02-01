import redis from '../src/utils/redisClient.js';

export default async function handler(req, res) {
    try {
        // 1. Reset Wallet to exactly $500
        const configStr = await redis.get('sentinel_wallet_config');
        const config = configStr ? JSON.parse(configStr) : {};

        config.initialBalance = 500;
        config.currentBalance = 500;
        config.allocatedCapital = 500;

        await redis.set('sentinel_wallet_config', JSON.stringify(config));

        // 2. Clear all active trades (Regular + Sniper)
        await redis.set('sentinel_active_trades', JSON.stringify([]));
        await redis.set('sentinel_sniper_trades', JSON.stringify([]));

        res.status(200).json({
            success: true,
            message: 'Clean Slate: Balance set to $500 and all duplicate/active trades cleared.'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
