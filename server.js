import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import checkPrices from './api/check-prices.js';
import manualTrade from './api/manual-trade.js';
import getStatus from './api/get-status.js'; // Assuming you have this or similar

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080; // Railway uses 8080 (or provided PORT)

app.use(cors());
app.use(express.json());

// --- API ROUTES (Adapter) ---
// We wrap the Vercel-style handlers (req, res) to work with Express

const vercelAdapter = (handler) => async (req, res) => {
    try {
        await handler(req, res);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: error.message });
    }
};

app.post('/api/check-prices', vercelAdapter(checkPrices)); // Supports POST (Force)
app.get('/api/check-prices', vercelAdapter(checkPrices));  // Supports GET (Cron)
app.post('/api/manual-trade', vercelAdapter(manualTrade));
// Add other routes here if needed
// app.get('/api/get-status', vercelAdapter(getStatus)); 

// --- SERVE FRONTEND (VITE BUILD) ---
app.use(express.static(path.join(__dirname, 'dist')));

// Handle React Routing (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// START SERVER
app.listen(PORT, () => {
    console.log(`🚀 Sentinel Bot Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    console.log(`🇪🇺 Region: ${process.env.REGION || 'Default'}`);
});
