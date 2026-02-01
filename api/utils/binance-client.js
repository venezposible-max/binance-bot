import crypto from 'crypto';
import axios from 'axios';
import querystring from 'querystring';

const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;

// Determinar URL base según Región y Modo
const getBaseUrl = () => {
    // Si tienes una variable específica para URL, úsala
    if (process.env.BINANCE_BASE_URL) return process.env.BINANCE_BASE_URL;
    // Si no, inferir por región
    return (process.env.REGION === 'EU' || !process.env.REGION)
        ? 'https://api.binance.com'
        : 'https://api.binance.us';
};

const sign = (queryString) => {
    return crypto
        .createHmac('sha256', API_SECRET)
        .update(queryString)
        .digest('hex');
};

// Wrapper para Peticiones Firmadas (Privadas)
const privateRequest = async (endpoint, method = 'GET', data = {}) => {
    if (!API_KEY || !API_SECRET) {
        throw new Error('MISSING_CREDENTIALS');
    }

    const timestamp = Date.now();
    const payload = { ...data, timestamp };
    const query = querystring.stringify(payload);
    const signature = sign(query);
    const fullQuery = `${query}&signature=${signature}`;

    const url = `${getBaseUrl()}${endpoint}?${fullQuery}`;

    try {
        const response = await axios({
            method,
            url,
            headers: { 'X-MBX-APIKEY': API_KEY }
        });
        return response.data;
    } catch (error) {
        console.error(`🚨 BINANCE API ERROR [${endpoint}]:`, error.response?.data || error.message);
        throw error; // Rethrow to be caught by caller
    }
};

// --- PUBLIC METHODS ---

export const getAccountBalance = async (asset = 'USDT') => {
    // Si NO hay API Key, retornamos 0 y error. NO MÁS 1000 FANTASMA.
    if (!API_KEY) {
        return { available: 0, total: 0, error: 'MISSING_API_KEY_ENV', isSimulated: true };
    }

    try {
        const data = await privateRequest('/api/v3/account');
        const balance = data.balances.find(b => b.asset === asset);
        return {
            available: parseFloat(balance?.free || 0),
            locked: parseFloat(balance?.locked || 0),
            total: parseFloat(balance?.free || 0) + parseFloat(balance?.locked || 0),
            isSimulated: false
        };
    } catch (e) {
        console.error('Balance Error:', e.message);
        // Retornamos 0 explícito en caso de error para no confundir
        return { available: 0, total: 0, error: e.message || 'API_CONNECTION_FAILED' };
    }
};

// --- HELPERS ---

// Helper to round quantity based on symbol (Simulates LOT_SIZE filter)
const formatQuantity = (symbol, qty) => {
    // Standard LOT_SIZE approximations for common Binance pairs
    let decimals = 5; // Default for many alts
    if (symbol.startsWith('BTC')) decimals = 5;
    if (symbol.startsWith('ETH')) decimals = 4;
    if (symbol.startsWith('SOL')) decimals = 3;
    if (symbol.startsWith('XRP')) decimals = 1;
    if (symbol.startsWith('DOGE')) decimals = 0;

    const factor = Math.pow(10, decimals);
    return Math.floor(qty * factor) / factor;
};

// Helper for price precision (Simulates TICK_SIZE filter)
const formatPrice = (symbol, price) => {
    let decimals = 2; // Default for most USDT pairs
    if (price < 1) decimals = 5;
    if (price < 0.01) decimals = 8;

    return price.toFixed(decimals);
};

export const executeOrder = async (symbol, side, quantity, currentPrice = 0, type = 'MARKET', isLiveOverride = null) => {
    // Priority: 1. Argument Override (from UI/Wallet) | 2. ENV Variable
    const isLive = isLiveOverride !== null ? isLiveOverride : (process.env.TRADING_MODE === 'LIVE');

    // 1. MIN NOTIONAL SAFETY ($10 Minimum)
    const investmentInUsd = (side === 'BUY') ? quantity : (quantity * (currentPrice || 1));
    if (investmentInUsd < 10.5) { // 10.5 to be safe against fees/spread
        throw new Error(`SAFETY: Investment $${investmentInUsd.toFixed(2)} is below Binance minimum (~$10)`);
    }

    if (!isLive) {
        const formattedQty = formatQuantity(symbol, side === 'BUY' ? (quantity / (currentPrice || 1)) : quantity);
        console.log(`🧪 SIMULATED ORDER: ${side} ${formattedQty} ${symbol} @ $${currentPrice}`);

        // Math for Sim
        let execQty = 0;
        let quoteQty = 0;

        if (side === 'BUY') {
            quoteQty = quantity;
            execQty = currentPrice > 0 ? formatQuantity(symbol, quantity / currentPrice) : 0;
        } else {
            execQty = formatQuantity(symbol, quantity);
            quoteQty = currentPrice > 0 ? (execQty * currentPrice) : 0;
        }

        return {
            status: 'FILLED',
            orderId: 'SIM_' + Date.now(),
            executedQty: execQty,
            cummulativeQuoteQty: quoteQty,
            avgPrice: currentPrice || 0
        };
    }

    // REAL EXECUTION 💸
    console.log(`💸 REAL ORDER EXECUTING: ${side} ${quantity} ${symbol}`);

    // Validaciones de Seguridad
    if (side === 'BUY' && quantity > 10000) throw new Error('SAFETY: Quantity too high for auto-bot');

    // Params para Binance
    const params = {
        symbol: symbol,
        side: side,
        type: type,
    };

    if (side === 'BUY') {
        params.quoteOrderQty = quantity.toFixed(2); // USDT precision
    } else {
        params.quantity = formatQuantity(symbol, quantity);
    }

    return await privateRequest('/api/v3/order', 'POST', params);
};

export default { getAccountBalance, executeOrder };
