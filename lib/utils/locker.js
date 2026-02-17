
import redis from './redisClient.js';

const SLEEP_MS = 100;
const MAX_RETRIES = 50; // 5 seconds max wait

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Tries to acquire a lock key.
 * @param {string} resource - Key name to lock
 * @param {number} ttl - Time to live in ms (safety release)
 * @returns {Promise<boolean>} - true if acquired
 */
export async function acquireLock(resource, ttl = 5000) {
    const key = `lock:${resource}`;
    // SET key value NX (Only if Not Exists) PX (Expiry ms)
    const result = await redis.set(key, 'LOCKED', 'NX', 'PX', ttl);
    return result === 'OK';
}

/**
 * Releases the lock.
 * @param {string} resource 
 */
export async function releaseLock(resource) {
    const key = `lock:${resource}`;
    await redis.del(key);
}

/**
 * Executes a function with a guaranteed lock.
 * Retries if busy.
 * @param {string} resource - Lock Key (e.g. 'trades_LIVE')
 * @param {Function} task - Async function to run
 * @param {number} ttl - Lock timeout
 */
export async function runWithLock(resource, task, ttl = 5000) {
    let retries = 0;
    while (retries < MAX_RETRIES) {
        const locked = await acquireLock(resource, ttl);
        if (locked) {
            try {
                // console.log(`🔒 LOCK ACQUIRED: ${resource}`);
                const result = await task();
                return result;
            } finally {
                await releaseLock(resource);
                // console.log(`🔓 LOCK RELEASED: ${resource}`);
            }
        }
        // Wait and retry
        await sleep(SLEEP_MS);
        retries++;
    }
    throw new Error(`Could not acquire lock for ${resource} after ${MAX_RETRIES} attempts.`);
}
