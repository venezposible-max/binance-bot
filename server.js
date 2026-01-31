import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

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

// Handle React Routing (SPA) with explicit NO-CACHE for index.html
app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// START SERVER
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60));
    console.log('🚀 SENTINEL BOT SYSTEMS ONLINE & STABLE | PORT', PORT);
    console.log('🌍 Environment:', process.env.NODE_ENV || 'production');
    console.log('🇪🇺 Region:', process.env.REGION || 'Default (US)');
    console.log('💓 Heartbeat: ENABLED (Every 60 seconds)');
    console.log('='.repeat(60));

    // FORCE IMMEDIATE RUN for user visibility
    setTimeout(async () => {
        try {
            console.log('⚡ FAST START: Triggering first price check immediately...');
            const response = await axios.get(`http://127.0.0.1:${PORT}/api/check-prices`);
            console.log(`✅ Startup scan completed - ${response.data.activeCount} active trades, ${response.data.newAlerts?.length || 0} alerts`);
        } catch (e) {
            console.error('❌ Startup scan error:', e.message);
            // Don't crash the server if startup scan fails
        }
    }, 5000); // Wait 5 seconds for server to be fully ready

    // --- AUTONOMOUS HEARTBEAT (For Paid Plans / VPS) ---
    // If the server stays alive, this loop ensures trading happens 24/7 without external triggers.
    setInterval(async () => {
        const now = new Date().toISOString();
        console.log(`\n💓 [${now}] Heartbeat: Triggering autonomous check...`);
        try {
            // Save heartbeat timestamp to Redis for status monitoring
            const redis = (await import('./src/utils/redisClient.js')).default;
            await redis.set('sentinel_last_heartbeat', now);

            // Call itself locally to trigger the check-prices logic
            const response = await axios.get(`http://127.0.0.1:${PORT}/api/check-prices`, { timeout: 5000 });
            console.log(`✅ [${now}] Heartbeat: Check completed - ${response.data.activeCount} active trades`);
        } catch (e) {
            console.error(`💔 [${now}] Heartbeat Error:`, e.message);
            // Don't crash the server if heartbeat fails
        }
    }, 60000); // Every 60 seconds

    // --- KEEPALIVE LOG (Every 1 minute to show server is alive visually) ---
    setInterval(() => {
        const memUsage = process.memoryUsage();
        console.log(`🟢 [${new Date().toISOString()}] Server OK | RAM: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
    }, 60000); // Every 1 minute
});

// Handle server errors
server.on('error', (error) => {
    console.error('❌ SERVER ERROR:', error);
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
        process.exit(1);
    }
});

console.log('✅ Server initialization complete');

