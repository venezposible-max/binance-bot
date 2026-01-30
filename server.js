import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// --- CRASH PREVENTION & LOGGING ---
console.log('🔥 SERVER STARTING... Catching all errors.');

process.on('uncaughtException', (err) => {
    console.error('💥 CRITICAL ERROR (Uncaught Exception):', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 CRITICAL ERROR (Unhandled Rejection):', reason);
});

// Import handlers 
import checkPrices from './api/check-prices.js';
import manualTrade from './api/manual-trade.js';
import getStatus from './api/get-status.js';
import walletConfig from './api/wallet/config.js';
import candles from './api/candles.js'; // Chart Data Proxy

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

console.log(`🔌 Configured PORT: ${PORT}`);

app.use(cors());
app.use(express.json());

// --- API ROUTES (Adapter) ---
const vercelAdapter = (handler) => async (req, res) => {
    try {
        await handler(req, res);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: error.message });
    }
};

app.post('/api/check-prices', vercelAdapter(checkPrices));
app.get('/api/check-prices', vercelAdapter(checkPrices));
app.post('/api/manual-trade', vercelAdapter(manualTrade));
app.get('/api/get-status', vercelAdapter(getStatus));
app.get('/api/wallet/config', vercelAdapter(walletConfig));
app.post('/api/wallet/config', vercelAdapter(walletConfig));
app.get('/api/candles', vercelAdapter(candles)); // Chart Proxy

// --- SERVE FRONTEND (VITE BUILD) ---
app.use(express.static(path.join(__dirname, 'dist')));

// Handle React Routing (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// START SERVER
try {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 SENTINEL BOT SERVER IS ALIVE ON PORT ${PORT}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
        console.log(`🇪🇺 Region: ${process.env.REGION || 'Default'}`);
    });
} catch (e) {
    console.error('❌ FATAL ERROR STARTING SERVER:', e);
}
