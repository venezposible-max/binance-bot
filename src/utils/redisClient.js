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
    console.warn('⚠️ WARNING: No REDIS_URL provided. Redis will not work.');
    // Mock Redis to prevent crash if env is missing (optional fallback)
    redis = new Redis({ lazyConnect: true });
}

export default redis;
