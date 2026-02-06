import redis from '../utils/redisClient.js';

export default async function handler(req, res) {
    const mode = req.query.mode || await redis.get('sentinel_active_mode') || 'SIMULATION';
    const redisKey = mode === 'LIVE' ? 'sentinel_wallet_config_real' : 'sentinel_wallet_config_sim';

    if (req.method === 'GET') {
        try {
            let configStr = await redis.get(redisKey);
            const existingConfig = configStr ? JSON.parse(configStr) : {};

            // Merge with defaults
            const config = {
                initialBalance: 1000,
                currentBalance: 1000,
                riskPercentage: 10,
                whaleThreshold: 150000,
                isBotActive: true,
                takeProfit: 1.25,
                // STOP LOSS DELETED AS REQUESTED
                swingMode: 'CONSERVATIVE',
                tradingMode: mode === 'LIVE' ? 'LIVE' : 'SIMULATION',
                strategyConfig: {
                    HYBRID_BLITZ: { active: true }
                },
                strategy: 'HYBRID_BLITZ',
                timeframe: '5m',
                ...existingConfig
            };

            res.status(200).json(config);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    } else if (req.method === 'POST') {
        try {
            const { initialBalance, riskPercentage, reset } = req.body;
            let newConfig;

            if (reset) {
                const currentStr = await redis.get(redisKey);
                const current = currentStr ? JSON.parse(currentStr) : {};

                newConfig = {
                    initialBalance: parseFloat(initialBalance),
                    currentBalance: parseFloat(initialBalance),
                    allocatedCapital: req.body.allocatedCapital ? parseFloat(req.body.allocatedCapital) : parseFloat(initialBalance),
                    tradingMode: mode === 'LIVE' ? 'LIVE' : 'SIMULATION',
                    riskPercentage: parseFloat(riskPercentage),
                    maxTrades: req.body.maxTrades ? parseInt(req.body.maxTrades) : (current.maxTrades || 3),
                    dailyLossLimit: req.body.dailyLossLimit ? parseFloat(req.body.dailyLossLimit) : (current.dailyLossLimit || 50),
                    cooldownMinutes: req.body.cooldownMinutes ? parseInt(req.body.cooldownMinutes) : (current.cooldownMinutes || 30),
                    isBotActive: current.isBotActive !== undefined ? current.isBotActive : true,
                    multiFrameMode: false,
                    strategy: 'HYBRID_BLITZ',
                    timeframe: '5m',
                    strategy: 'HYBRID_BLITZ',
                    timeframe: '5m',
                    strategyConfig: req.body.strategyConfig || current.strategyConfig || {
                        HYBRID_BLITZ: { active: true, minOdds: 67 }
                    },
                    whaleThreshold: req.body.whaleThreshold ? parseFloat(req.body.whaleThreshold) : (current.whaleThreshold || 150000)
                };
            } else {
                const configStr = await redis.get(redisKey);
                const existing = configStr ? JSON.parse(configStr) : {};
                newConfig = { ...existing, ...req.body };

                if (newConfig.riskPercentage) newConfig.riskPercentage = parseFloat(newConfig.riskPercentage);
                if (newConfig.allocatedCapital) newConfig.allocatedCapital = parseFloat(newConfig.allocatedCapital);
                if (newConfig.whaleThreshold) newConfig.whaleThreshold = parseFloat(newConfig.whaleThreshold);
            }

            await redis.set(redisKey, JSON.stringify(newConfig));
            res.status(200).json(newConfig);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    } else {
        res.setHeader('Allow', ['GET', 'POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}
