import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

// --- MODULE IMPORTS (Consolidated) ---
import { LogStore } from './api/utils/logger.js';
import logsHandler from './api/logs.js';
import telegramProxy from './api/telegram-proxy.js';
import checkPrices from './api/check-prices.js';
import manualTrade from './api/manual-trade.js';
import getStatus from './api/get-status.js';
import walletConfig from './api/wallet/config.js';
import candles from './api/candles.js';
import ticker from './api/ticker.js';
import walletBalance from './api/wallet/balance.js'; // Restored Import ✅
import portfolioHandler from './api/olga/portfolio.js'; // Olga is back!
import activeMode from './api/wallet/active-mode.js';
import marketWorker from './api/stream/market-worker.js';
import debug from './api/debug.js';
import cleanup from './api/cleanup.js';
import getMarketPairs from './api/get-market-pairs.js'; // NEW: Sync Endpoint
import lockdown from './api/lockdown.js'; // NEW: Emergency Switch
import removeTrade from './api/remove-trade.js'; // NEW: Manual Trade Removal
import arbitrageVes from './api/arbitrage-ves.js'; // NEW: Arbitrage Monitor
import unixaBacktest from './api/unixa-backtest.js';


// --- LOG CAPTURE HOOK ---
// Capture logs for the frontend console
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

// Initialize overrides safely
console.log = (...args) => { originalLog(...args); try { LogStore.add('INFO', ...args); } catch (e) { } };
console.error = (...args) => { originalError(...args); try { LogStore.add('ERROR', ...args); } catch (e) { } };
console.warn = (...args) => { originalWarn(...args); try { LogStore.add('WARN', ...args); } catch (e) { } };

// --- CRASH PREVENTION & LOGGING ---
console.log('========================================');
console.log('🔥 SERVER STARTING...');
console.log('🚀 DEPLOYMENT TRIGGER CHECK: V_0_0_4_FORCE_PERSISTENCE (TIMESTAMP: ' + new Date().toISOString() + ')');
console.log('Node Version:', process.version);
console.log('========================================');

process.on('uncaughtException', (err) => {
    console.error('💥 CRITICAL ERROR (Uncaught Exception):', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 CRITICAL ERROR (Unhandled Rejection):', reason);
});

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

console.log(`🔌 Configured PORT: ${PORT}`);

app.use(cors({
    origin: '*', // Allow all (Vercel, Localhost, etc.)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-cron-secret']
}));
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

// Registered Routes
app.post('/api/check-prices', vercelAdapter(checkPrices));
app.post('/api/check-prices', vercelAdapter(checkPrices));
app.get('/api/check-prices', vercelAdapter(checkPrices));
app.get('/api/get-market-pairs', vercelAdapter(getMarketPairs)); // NEW: Sync Endpoint
app.post('/api/manual-trade', vercelAdapter(manualTrade));
app.get('/api/get-status', vercelAdapter(getStatus));
app.get('/api/wallet/config', vercelAdapter(walletConfig));
app.post('/api/wallet/config', vercelAdapter(walletConfig));
app.get('/api/wallet/balance', vercelAdapter(walletBalance));
app.get('/api/wallet/active-mode', vercelAdapter(activeMode));
app.post('/api/wallet/active-mode', vercelAdapter(activeMode));

app.post('/api/lockdown', vercelAdapter(lockdown)); // NEW: Emergency
app.get('/api/logs', vercelAdapter(logsHandler)); // Live Logs
app.get('/api/telegram-proxy', vercelAdapter(telegramProxy)); // Telegram Proxy
app.get('/api/remove-trade', vercelAdapter(removeTrade)); // NEW: Manual Trade Removal

app.get('/api/candles', vercelAdapter(candles)); // Chart Proxy
app.get('/api/ticker', vercelAdapter(ticker)); // Real-time Price Proxy
app.get('/api/olga/portfolio', vercelAdapter(portfolioHandler)); // NEW: Olga Safe Endpoint 👩‍💼
app.get('/api/arbitrage/ves', vercelAdapter(arbitrageVes));
app.post('/api/arbitrage/ves', vercelAdapter(arbitrageVes));
app.post('/api/unixa-backtest', vercelAdapter(unixaBacktest));


// Phase 1: High-Speed Market Cache
app.get('/api/market-cache', (req, res) => {
    res.json(marketWorker.getAllMarketData());
});

app.get('/api/debug', vercelAdapter(debug));
app.get('/api/cleanup', vercelAdapter(cleanup));

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
let isScanRunning = false;
const runInternalScan = async (source = 'TIMER') => {
    if (isScanRunning) {
        console.log(`⚠️ [${source}] Scan already in progress. Skipping overlap.`);
        return;
    }
    isScanRunning = true;
    console.log(`\n⏳ [${new Date().toISOString()}] INTERNAL CRON (${source}): Triggering Scan...`);

    try {
        if (marketWorker.activeBan) {
            console.log(`⏳ [${source}] Scan skipped - IP BANNED. Waiting for cooldown...`);
            return;
        }

        const response = await axios.get(`http://127.0.0.1:${PORT}/api/check-prices`, {
            headers: { 'x-cron-secret': process.env.CRON_SECRET }, // SECURE HANDSHAKE
            timeout: 60000 // Increased to 60s for heavy scanning
        });

        const activeCount = response.data.activeCount || 0;
        const alerts = response.data.newAlerts?.length || 0;
        console.log(`✅ SCAN COMPLETE: ${activeCount} Active Trades | ${alerts} New Alerts`);

        // Keep heartbeat alive in Redis (if available)
        try {
            const redis = await import('./src/utils/redisClient.js');
            if (redis.default) {
                redis.default.set('sentinel_last_heartbeat', new Date().toISOString());
            }
        } catch (e) { }



    } catch (e) {
        console.error(`❌ CRON FAIL [${source}]:`, e.message);
    } finally {
        isScanRunning = false;
    }
};

// START SERVER
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60));
    console.log('🚀 SENTINEL BOT SYSTEMS ONLINE & STABLE | PORT', PORT);
    console.log('🌍 Environment:', process.env.NODE_ENV || 'production');
    console.log('🔐 VIP DATA MODE:', process.env.BINANCE_API_KEY ? 'ENABLED' : 'DISABLED');
    console.log('='.repeat(60));

    // START REAL-TIME MARKET WORKER
    marketWorker.start();

    // FORCE IMMEDIATE RUN
    setTimeout(() => runInternalScan('STARTUP_FAST'), 3000);
});

// Loop every 10 seconds to stay within RPC limits
// Loop every 20 seconds to be safer with weight (20 coins x 3 cycles = 60 weight/min)
setInterval(() => runInternalScan('HEARTBEAT'), 20000);

// --- KEEPALIVE LOG (Every 2 minutes) ---
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
// FORCE DEPLOY
