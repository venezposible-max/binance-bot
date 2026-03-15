import binanceClient from '../utils/binance-client.js';
import redis from '../utils/redisClient.js';
import marketWorker from '../stream/market-worker.js';

export default async function handler(req, res) {
    try {
        if (marketWorker.isBanned) {
            throw new Error('IP_BANNED');
        }

        const balanceData = await binanceClient.getAccountBalance('USDT');

        if (balanceData && !balanceData.error) {
            res.status(200).json(balanceData);
            return;
        }
        throw new Error(balanceData.error || 'FETCH_FAIL');

    } catch (error) {
        console.warn('⚠️ Live Balance Fetch Failed, using cache:', error.message);

        // Error is expected if banned, so we fall back to Redis
        try {
            const configKey = 'sentinel_wallet_config_real'; // Assuming live balance is what matters most
            const cachedConfig = await redis.get(configKey);

            if (cachedConfig) {
                const wallet = JSON.parse(cachedConfig);
                res.status(200).json({
                    available: wallet.currentBalance || 0,
                    total: wallet.currentBalance || 0,
                    isCached: true,
                    isBanned: marketWorker.isBanned
                });
            } else {
                res.status(200).json({ available: 0, total: 0, error: 'NO_CACHE', isBanned: marketWorker.isBanned });
            }
        } catch (redisErr) {
            res.status(500).json({ error: 'DATABASE_FAIL' });
        }
    }
}
