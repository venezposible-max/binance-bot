import redis from '../../src/utils/redisClient.js';

export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            const configStr = await redis.get('sentinel_wallet_config');
            const existingConfig = configStr ? JSON.parse(configStr) : {};

            // Merge with defaults to ensure all required fields exist
            const config = {
                initialBalance: 1000,
                currentBalance: 1000,
                riskPercentage: 10,
                whaleThreshold: 150000,
                isBotActive: true, // Default State: ACTIVATED
                ...existingConfig // Override with existing values if present
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
                // Get current state to preserve isBotActive status
                const currentStr = await redis.get('sentinel_wallet_config');
                const current = currentStr ? JSON.parse(currentStr) : {};

                newConfig = {
                    initialBalance: parseFloat(initialBalance),
                    currentBalance: parseFloat(initialBalance),
                    allocatedCapital: req.body.allocatedCapital ? parseFloat(req.body.allocatedCapital) : parseFloat(initialBalance), // New: Real Money Cap
                    tradingMode: req.body.tradingMode || 'SIMULATION', // New: LIVE or SIMULATION
                    riskPercentage: parseFloat(riskPercentage),
                    isBotActive: current.isBotActive !== undefined ? current.isBotActive : true,
                    multiFrameMode: false,
                    strategy: req.body.strategy || current.strategy || 'SWING',
                    timeframe: req.body.timeframe || current.timeframe || '4h',
                    whaleThreshold: req.body.whaleThreshold ? parseFloat(req.body.whaleThreshold) : (current.whaleThreshold || 150000)
                };
            } else {
                // Update specific fields
                const configStr = await redis.get('sentinel_wallet_config');
                const existing = configStr ? JSON.parse(configStr) : {};

                newConfig = { ...existing, ...req.body };
                // Ensure numeric types
                if (newConfig.riskPercentage) newConfig.riskPercentage = parseFloat(newConfig.riskPercentage);
                if (newConfig.allocatedCapital) newConfig.allocatedCapital = parseFloat(newConfig.allocatedCapital);
                if (newConfig.whaleThreshold) newConfig.whaleThreshold = parseFloat(newConfig.whaleThreshold);
            }


            await redis.set('sentinel_wallet_config', JSON.stringify(newConfig));
            res.status(200).json(newConfig);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    } else {
        res.setHeader('Allow', ['GET', 'POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}
