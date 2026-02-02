import redis from './utils/redisClient.js';

export default async function handler(req, res) {
    try {
        console.log('🧹 MANUALLY TRIGGERED CLEANUP');

        // 1. Reset Wallets (Live & Sim)
        const configKeys = ['sentinel_wallet_config', 'sentinel_wallet_config_real', 'sentinel_wallet_config_sim'];
        for (const key of configKeys) {
            const configStr = await redis.get(key);
            if (configStr) {
                const config = JSON.parse(configStr);
                // Only reset balance for SIM
                if (key.includes('sim') || key === 'sentinel_wallet_config') {
                    config.currentBalance = 1000;
                }
                await redis.set(key, JSON.stringify(config));
            }
        }

        // 2. Clear all active trades (Regular + Sniper) for ALL MODES
        const keysToWipe = [
            'sentinel_active_trades',
            'sentinel_sniper_trades',
            'sentinel_active_trades_real',
            'sentinel_active_trades_sim',
            'sentinel_sniper_trades_real',
            'sentinel_sniper_trades_sim'
        ];

        for (const key of keysToWipe) {
            await redis.del(key);
            // Also set to empty array just in case
            await redis.set(key, JSON.stringify([]));
        }

        res.status(200).json({
            success: true,
            message: '🧹 CLEANUP COMPLETE: All active trade lists (Live & Sim) have been wiped from Redis.'
        });
    } catch (error) {
        console.error('Cleanup Error:', error);
        res.status(500).json({ error: error.message });
    }
}
