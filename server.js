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
import ticker from './api/ticker.js'; // Real-time Price Proxy

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


// ... (existing code)

app.get('/api/candles', vercelAdapter(candles)); // Chart Proxy
app.get('/api/ticker', vercelAdapter(ticker)); // Real-time Price Proxy

// --- SERVE FRONTEND (VITE BUILD) ---
app.use(express.static(path.join(__dirname, 'dist')));

// Handle React Routing (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// START SERVER
try {
    app.listen(PORT, '0.0.0.0', () => {
        console.log('='.repeat(60));
        console.log('🚀 SENTINEL BOT SERVER IS ALIVE ON PORT', PORT);
        console.log('🌍 Environment:', process.env.NODE_ENV || 'production');
        console.log('🇪🇺 Region:', process.env.REGION || 'Default (US)');
        console.log('💓 Heartbeat: ENABLED (Every 60 seconds)');
        console.log('='.repeat(60));

        // --- AUTONOMOUS HEARTBEAT (For Paid Plans / VPS) ---
        // If the server stays alive, this loop ensures trading happens 24/7 without external triggers.
        setInterval(async () => {
            const now = new Date().toISOString();
            console.log(`\n💓 [${now}] Heartbeat: Triggering autonomous check...`);
            try {
                // Call itself locally to trigger the check-prices logic
                // Using localhost ensures we use the same express handler logic
                const response = await axios.get(`http://127.0.0.1:${PORT}/api/check-prices`);
                console.log(`✅ [${now}] Heartbeat: Check completed - ${response.data.activeCount} active trades`);
            } catch (e) {
                console.error(`💔 [${now}] Heartbeat Error:`, e.message);
            }
        }, 60000); // Every 60 seconds
    });
} catch (e) {
    console.error('❌ FATAL ERROR STARTING SERVER:', e);
}
