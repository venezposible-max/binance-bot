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
                newConfig = {
                    initialBalance: parseFloat(initialBalance),
                    currentBalance: parseFloat(initialBalance),
                    riskPercentage: parseFloat(riskPercentage),
                    multiFrameMode: false // Reset defaults to OFF
                };
            } else {
                // Generic Update (Merge)
                const currentStr = await redis.get('sentinel_wallet_config');
                const current = currentStr ? JSON.parse(currentStr) : {};

                newConfig = {
                    ...current,
                    ...req.body, // Merge new flags like multiFrameMode
                    // Protect critical fields unless explicitly provided in body
                    currentBalance: req.body.currentBalance !== undefined ? req.body.currentBalance : current.currentBalance,
                    initialBalance: req.body.initialBalance !== undefined ? req.body.initialBalance : current.initialBalance,
                    riskPercentage: req.body.riskPercentage !== undefined ? req.body.riskPercentage : current.riskPercentage
                };
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
