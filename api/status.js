import redis from '../src/utils/redisClient.js';

export default async function handler(req, res) {
    try {
        // Get last heartbeat timestamp from Redis
        const lastHeartbeat = await redis.get('sentinel_last_heartbeat');
        const lastHeartbeatTime = lastHeartbeat ? new Date(lastHeartbeat) : null;

        // Get current time
        const now = new Date();

        // Calculate seconds since last heartbeat
        const secondsSinceLastBeat = lastHeartbeatTime
            ? Math.floor((now - lastHeartbeatTime) / 1000)
            : null;

        // Get active trades
        const activeTradesStr = await redis.get('sentinel_active_trades');
        const activeTrades = activeTradesStr ? JSON.parse(activeTradesStr) : [];

        // Get wallet config
        const walletConfigStr = await redis.get('sentinel_wallet_config');
        const wallet = walletConfigStr ? JSON.parse(walletConfigStr) : {};

        // Determine status
        const isHealthy = secondsSinceLastBeat !== null && secondsSinceLastBeat < 90; // Should beat every 60s

        res.status(200).json({
            status: isHealthy ? 'HEALTHY' : 'WARNING',
            cronInternal: {
                enabled: true,
                interval: '60 seconds',
                lastHeartbeat: lastHeartbeatTime ? lastHeartbeatTime.toISOString() : 'Never',
                secondsSinceLastBeat: secondsSinceLastBeat,
                nextExpectedBeat: lastHeartbeatTime
                    ? new Date(lastHeartbeatTime.getTime() + 60000).toISOString()
                    : 'Unknown'
            },
            bot: {
                region: process.env.REGION || 'US',
                strategy: wallet.strategy || 'SWING',
                activeTrades: activeTrades.length,
                balance: wallet.currentBalance || 0
            },
            server: {
                uptime: process.uptime(),
                timestamp: now.toISOString()
            }
        });
    } catch (error) {
        console.error('Status endpoint error:', error);
        res.status(500).json({ error: error.message });
    }
}
