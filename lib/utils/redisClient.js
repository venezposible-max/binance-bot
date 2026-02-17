import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;

console.log(`🔌 Initializing Redis Client... ${REDIS_URL ? 'URL Found' : 'NO URL PROVIDED'}`);

let redis;

if (REDIS_URL) {
    const isInternal = REDIS_URL.includes('.internal'); // Railway Private DNS
    console.log(`🔌 Redis Mode: ${isInternal ? 'Internal (IPv6)' : 'Public/External (IPv4)'}`);

    redis = new Redis(REDIS_URL, {
        family: isInternal ? 6 : 0, // Auto-detect for public, Force IPv6 for internal
        maxRetriesPerRequest: null,
        retryStrategy(times) {
            const delay = Math.min(times * 50, 2000);
            return delay;
        }
    });

    redis.on('connect', () => {
        console.log('✅ Redis Connected Successfully');
    });

    redis.on('error', (err) => {
        // Prevent App Crash on Connection Error
        console.error('❌ Redis Client Error (Handled):', err.message);
    });
} else {
    console.warn('⚠️ WARNING: No REDIS_URL provided. using IN-MEMORY FALLBACK (Data lost on restart).');
    // Mock Redis using a simple Map to keep app alive without external DB
    const memoryStore = new Map();
    redis = {
        status: 'ready',
        get: async (key) => memoryStore.get(key) || null,
        set: async (key, val) => { memoryStore.set(key, val); return 'OK'; },
        del: async (key) => { return memoryStore.delete(key) ? 1 : 0; },
        mget: async (keys) => keys.map(k => memoryStore.get(k) || null),
        pipeline: () => ({
            set: (key, val) => { memoryStore.set(key, val); return { exec: async () => [] }; },
            exec: async () => []
        }),
        on: (event, callback) => { /* No-op for events */ },
        quit: async () => { /* No-op */ }
    };
}

export default redis;
