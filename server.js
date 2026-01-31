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

// IMPORT CRON HANDLER DIRECTLY (Bypass Network Issues)
import checkPriceHandler from './api/check-prices.js';

// --- ROBUST INTERNAL CRON (No HTTP reqs needed) ---
const runInternalScan = async (source = 'TIMER') => {
    console.log(`\n⏰ [${new Date().toISOString()}] INTERNAL CRON (${source}): Executing Scan...`);

    // Mock Request/Response for the handler
    const req = { method: 'GET', query: {}, body: {} };
    const res = {
        setHeader: () => { },
        status: (code) => ({
            json: (data) => {
                const active = data.activeCount !== undefined ? data.activeCount : (data.active?.length || 0);
                console.log(`✅ SCAN COMPLETE: ${active} Active Trades | Code ${code}`);
                // Keep heartbeat alive in Redis
                import('./src/utils/redisClient.js').then(m => {
                    m.default.set('sentinel_last_heartbeat', new Date().toISOString());
                });
            },
            end: () => console.log('✅ SCAN COMPLETE (Empty Response)')
        })
    };

    try {
        await checkPriceHandler(req, res);
    } catch (e) {
        console.error('❌ INTERNAL CRON ERROR:', e.message);
    }
};

// START SERVER
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60));
    console.log('🚀 SENTINEL BOT SYSTEMS ONLINE & STABLE | PORT', PORT);
    console.log('🌍 Environment:', process.env.NODE_ENV || 'production');
    console.log('🔐 VIP DATA MODE:', process.env.BINANCE_API_KEY ? 'ENABLED' : 'DISABLED');
    console.log('💓 Heartbeat: ENABLED (Direct Internal Execution)');
    console.log('='.repeat(60));

    // FORCE IMMEDIATE RUN
    setTimeout(() => runInternalScan('STARTUP_FAST'), 3000);
});

// Loop every 60 seconds
setInterval(() => runInternalScan('HEARTBEAT'), 60000);

// --- KEEPALIVE LOG (Every 1 minute to show server is alive visually) ---
setInterval(() => {
    const memUsage = process.memoryUsage();
    console.log(`🟢 [${new Date().toISOString()}] Server OK | RAM: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
}, 60000); // Every 1 minute

// Handle server errors
server.on('error', (error) => {
    console.error('❌ SERVER ERROR:', error);
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
        process.exit(1);
    }
});

console.log('✅ Server initialization complete');

