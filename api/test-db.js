import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

export default async function handler(req, res) {
    try {
        console.log('Testing Redis Connection...');

        // 1. Intentar escribir un valor de prueba
        const testKey = 'sentinel_ping';
        const testValue = new Date().toISOString();
        await redis.set(testKey, testValue);

        // 2. Intentar leerlo de vuelta
        const result = await redis.get(testKey);

        if (result === testValue) {
            res.status(200).json({
                status: '✅ CONECTADO A REDIS',
                message: 'La base de datos externa de Redis responde correctamente.',
                timestamp: result
            });
        } else {
            throw new Error('El valor recuperado no coincide.');
        }
    } catch (error) {
        console.error('Redis Connection Error:', error);
        res.status(500).json({
            status: '❌ ERROR DE CONEXIÓN',
            message: 'No se pudo comunicar con tu base de datos Redis externa.',
            error: error.message
        });
    }
}
