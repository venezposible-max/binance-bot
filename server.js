import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

// --- CRASH PREVENTION & LOGGING ---
console.log('========================================');
console.log('🔥 SERVER STARTING...');
console.log('Node Version:', process.version);
console.log('Platform:', process.platform);
console.log('CWD:', process.cwd());
console.log('========================================');

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
import walletBalance from './api/wallet/balance.js'; // New

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

// ... (middleware setup)

app.post('/api/check-prices', vercelAdapter(checkPrices));
app.get('/api/check-prices', vercelAdapter(checkPrices));
app.post('/api/manual-trade', vercelAdapter(manualTrade));
app.get('/api/get-status', vercelAdapter(getStatus));
app.get('/api/wallet/config', vercelAdapter(walletConfig));
app.post('/api/wallet/config', vercelAdapter(walletConfig));
app.get('/api/wallet/config', vercelAdapter(walletConfig));
app.post('/api/wallet/config', vercelAdapter(walletConfig));
app.get('/api/wallet/balance', vercelAdapter(walletBalance)); // New Route

// CVD SNIPER SERVICE (Singleton)
import cvdSniper from './api/stream/cvd-worker.js';
app.get('/api/cvd', (req, res) => {
    res.json(cvdSniper.getData());
});

// DEBUG ENDPOINT
import debug from './api/debug.js';
app.get('/api/debug', vercelAdapter(debug));

// CLEAR SNIPER TRADES (for testing)
import clearSniper from './api/clear-sniper.js';
app.post('/api/clear-sniper', vercelAdapter(clearSniper));

// SESSION CLEANUP (One-time utility)
import cleanup from './api/cleanup.js';
app.get('/api/cleanup', vercelAdapter(cleanup));



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


// --- ROBUST INTERNAL CRON (HTTP Self-Call) ---
const runInternalScan = async (source = 'TIMER') => {
    console.log(`\n⏳ [${new Date().toISOString()}] INTERNAL CRON (${source}): Triggering Scan...`);

    try {
        const response = await axios.get(`http://127.0.0.1:${PORT}/api/check-prices`, {
            timeout: 20000 // Aumentado a 20s para permitir API calls lentas
        });

        const activeCount = response.data.activeCount || 0;
        const alerts = response.data.newAlerts?.length || 0;
        console.log(`✅ SCAN COMPLETE: ${activeCount} Active Trades | ${alerts} New Alerts | Status ${response.status}`);

        // Keep heartbeat alive in Redis
        import('./src/utils/redisClient.js').then(m => {
            m.default.set('sentinel_last_heartbeat', new Date().toISOString());
        }).catch(() => { });

    } catch (e) {
        console.error(`❌ CRON FAIL [${source}]:`, e.message);
        if (e.code === 'ECONNREFUSED') {
            console.error('   -> Server might be restarting or port is blocked.');
        }
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

// Loop every 30 seconds (High Frequency Patrol)
setInterval(() => runInternalScan('HEARTBEAT'), 30000);

// --- KEEPALIVE LOG (Every 2 minutes to reduce noise but show life) ---
setInterval(() => {
    const memUsage = process.memoryUsage();
    console.log(`🟢 [${new Date().toISOString()}] SYSTEM HEARTBEAT | RAM: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB | Uptime: ${process.uptime().toFixed(0)}s`);
}, 120000);

// Handle server errors
server.on('error', (error) => {
    console.error('❌ SERVER ERROR:', error);
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
        process.exit(1);
    }
});

console.log('✅ Server initialization complete');

