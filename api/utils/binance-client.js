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

// CORREGIDO: Acepta currentPrice como argumento opcional para simulaciones precisas
// Firma anterior causaba conflicto: (symbol, side, qty, type) vs llamada (symbol, side, qty, price)
export const executeOrder = async (symbol, side, quantity, currentPrice = 0, type = 'MARKET') => {
    const isLive = process.env.TRADING_MODE === 'LIVE';

    if (!isLive) {
        console.log(`🧪 SIMULATED ORDER: ${side} ${quantity} ${symbol} @ $${currentPrice}`);
        // Math for Sim
        // If BUY, quantity is USDT. If SELL, quantity is COIN.
        let execQty = 0;
        let quoteQty = 0;

        if (side === 'BUY') {
            quoteQty = quantity;
            execQty = currentPrice > 0 ? (quantity / currentPrice) : 0;
        } else {
            execQty = quantity;
            quoteQty = currentPrice > 0 ? (quantity * currentPrice) : 0;
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
        // quantity: quantity  <-- OJO: Binance pide steps exactos. Mejor usar quoteOrderQty para buys en USDT
    };

    if (side === 'BUY') {
        // Al comprar, solemos decir "Quiero gastar 50 USDT", no "Quiero 0.0023 BTC"
        params.quoteOrderQty = quantity; // quantity here is amount in USDT
    } else {
        // Al vender, es quantity de la moneda base
        params.quantity = quantity;
    }

    return await privateRequest('/api/v3/order', 'POST', params);
};

export default { getAccountBalance, executeOrder };
