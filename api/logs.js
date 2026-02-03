import { LogStore } from './utils/logger.js';

export default async function handler(req, res) {
    if (req.method === 'GET') {
        const logs = LogStore.get();
        // Return active logs, reversed so newest is arguably at bottom? 
        // Terminals usually print top-down. 
        // Arrays push to end. So index 0 is old, index N is new.
        // Client can render in order.
        return res.json({ logs });
    }

    res.status(405).json({ error: 'Method Not Allowed' });
}
