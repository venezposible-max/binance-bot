import redis from './utils/redisClient.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { active } = req.body; // true = LOCKDOWN (Disconnect), false = UNLOCK

    try {
        if (active) {
            await redis.set('sentinel_lockdown', 'true');
            console.log('⛔ EMERGENCY LOCKDOWN ACTIVATED');
        } else {
            await redis.del('sentinel_lockdown');
            console.log('✅ SYSTEM UNLOCKED');
        }

        return res.json({ success: true, lockdown: active });
    } catch (error) {
        console.error('Lockdown Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
