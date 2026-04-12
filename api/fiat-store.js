import redisClient from './utils/redisClient.js';

export default async function handler(req, res) {
    try {
        const REDIS_KEY = 'fiat_purchases_history';

        // GET: Fetch the persisted FIAT records
        if (req.method === 'GET') {
            let dataStr = await redisClient.get(REDIS_KEY);
            let data = dataStr ? JSON.parse(dataStr) : [];
            return res.status(200).json({ success: true, count: data.length, data });
        }

        // POST: Merge new FIAT records from CSV upload
        if (req.method === 'POST') {
            const { newRecords } = req.body;
            if (!newRecords || !Array.isArray(newRecords)) {
                return res.status(400).json({ error: 'Payload incorrecto, se requiere campo newRecords (Array).' });
            }

            // Validar que en efecto haya sido decodificado algo util
            if (newRecords.length === 0) return res.status(200).json({ success: true, inserted: 0, total: 0 });

            // Cargar base de datos actual
            let currentStr = await redisClient.get(REDIS_KEY);
            let currentDb = currentStr ? JSON.parse(currentStr) : [];

            // Convertir la base de datos a un Mapa para agilizar por ID (orderNo u otra clave unica)
            // Ya que el CSV de Binance a veces no tiene OrderNo pero sí Fecha y Monto,
            // podemos crear un ID virtual: Base64(date + amount + card)
            let dbMap = new Map();
            currentDb.forEach(r => dbMap.set(r.id, r));

            let addedCount = 0;
            newRecords.forEach(record => {
                if (!dbMap.has(record.id)) {
                    dbMap.set(record.id, record);
                    addedCount++;
                }
            });

            const updatedDb = Array.from(dbMap.values());
            // Ordenar por timestamp descendente
            updatedDb.sort((a, b) => b.timestamp - a.timestamp);

            await redisClient.set(REDIS_KEY, JSON.stringify(updatedDb));

            return res.status(200).json({ 
                success: true, 
                inserted: addedCount, 
                total: updatedDb.length,
                data: updatedDb
            });
        }

        res.status(405).json({ error: 'Method Not Allowed' });
    } catch (error) {
        console.error('Fiat Store Data Error:', error);
        res.status(500).json({ error: error.message });
    }
}
