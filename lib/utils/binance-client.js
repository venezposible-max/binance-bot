import 'dotenv/config';
import crypto from 'crypto';
import axios from 'axios';
import querystring from 'querystring';

const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;

// Determinar URL base según Región y Modo
const getBaseUrl = () => {
    // Si tienes una variable específica para URL, úsala
    if (process.env.BINANCE_BASE_URL) return process.env.BINANCE_BASE_URL;
    // Si no, inferir por región (Prioritize domains that bypass CloudFront 403)
    // ONLY use .US if explicitly set to US. Everything else (EU, WORLD, undefined) goes to Global/GCP.
    return 'https://api.binance.com'; // User Priority: Force Global (No US) // Default to Global GCP mirror
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

export const getAccountBalance = async (asset = null) => {
    if (!API_KEY) {
        return { available: 0, total: 0, error: 'MISSING_API_KEY_ENV', isSimulated: true };
    }

    try {
        const data = await privateRequest('/api/v3/account');
        if (!asset || asset === 'ALL') {
            return data; // Return full account data
        }

        const balance = data.balances.find(b => b.asset === asset);
        return {
            available: parseFloat(balance?.free || 0),
            locked: parseFloat(balance?.locked || 0),
            total: parseFloat(balance?.free || 0) + parseFloat(balance?.locked || 0),
            isSimulated: false
        };
    } catch (e) {
        console.error('Balance Error:', e.message);
        return { available: 0, total: 0, error: e.message || 'API_CONNECTION_FAILED' };
    }
};

// --- HELPERS ---

// Cache for Symbol Rules (Step Size, Tick Size)
const exchangeInfoCache = {};

const getSymbolRules = async (symbol) => {
    if (exchangeInfoCache[symbol]) return exchangeInfoCache[symbol];

    try {
        const data = await axios.get(`${getBaseUrl()}/api/v3/exchangeInfo`, { params: { symbol } });
        const info = data.data.symbols[0];

        // Extract Filters
        const lotFilter = info.filters.find(f => f.filterType === 'LOT_SIZE');
        const priceFilter = info.filters.find(f => f.filterType === 'PRICE_FILTER');
        const notionalFilter = info.filters.find(f => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL');

        const rules = {
            stepSize: lotFilter ? parseFloat(lotFilter.stepSize) : 1,
            tickSize: priceFilter ? parseFloat(priceFilter.tickSize) : 0.01,
            minNotional: notionalFilter ? parseFloat(notionalFilter.minNotional) : 10
        };

        exchangeInfoCache[symbol] = rules;
        return rules;
    } catch (e) {
        console.warn(`⚠️ Failed to fetch exchange rules for ${symbol}, using defaults.`, e.message);
        // Fallback Defaults
        return { stepSize: 0.1, tickSize: 0.01, minNotional: 10 };
    }
};

// Precise Math Rounding (Avoid Float Errors)
const roundStep = (qty, stepSize) => {
    // 1. Calculate precision (decimals) from stepSize
    // e.g. 0.001 -> 3 decimals
    const precision = stepSize.toString().split('.')[1]?.length || 0;

    // 2. Round DOWN to nearest step (floor)
    // Formula: floor(qty / step) * step
    const factor = 1 / stepSize;
    const rounded = Math.floor(qty * factor) / factor;
    return rounded.toFixed(precision);
};

export const executeOrder = async (symbol, side, quantity, currentPrice = 0, type = 'MARKET', isLiveOverride = null) => {
    const formattedSymbol = symbol.toUpperCase();
    const isLive = isLiveOverride !== null ? isLiveOverride : (process.env.TRADING_MODE === 'LIVE');

    if (!isLive) {
        // Simulation Logic (Simplified)
        console.log(`🧪 SIMULATED ORDER: ${side} ${quantity} ${formattedSymbol} @ $${currentPrice}`);
        return {
            status: 'FILLED',
            orderId: 'SIM_' + Date.now(),
            executedQty: quantity, // Just echo back
            cummulativeQuoteQty: (side === 'BUY') ? quantity : (quantity * (currentPrice || 1)),
            avgPrice: currentPrice || 0
        };
    }

    // REAL EXECUTION 💸
    console.log(`💸 REAL ORDER PREP: ${side} ${quantity} ${formattedSymbol}`);

    // 1. Fetch Precise Rules
    const rules = await getSymbolRules(formattedSymbol);

    // 2. Format Quantity/Amount according to Binance Filters
    const params = {
        symbol: formattedSymbol,
        side: side,
        type: type,
    };

    if (side === 'BUY') {
        // For MARKET BUY, we usually send quoteOrderQty (USDT Amount)
        // Check Min Notional
        if (quantity < rules.minNotional) {
            throw new Error(`SAFETY: Buy amount $${quantity} is below Binance minimum ($${rules.minNotional})`);
        }

        // Round USDT amount (usually 2 decimals for USDT pairs, dependent on tickSize of quote asset technically, but 2 is standard safe for USDT)
        params.quoteOrderQty = quantity.toFixed(2);

    } else {
        // For SELL, we must send quantity (Crypto Amount) rounded to LOT_SIZE
        const adjustedQty = roundStep(quantity, rules.stepSize);

        // Check Min Notional (approximate)
        if ((parseFloat(adjustedQty) * currentPrice) < (rules.minNotional * 0.9)) {
            // *0.9 tolerance because price fluctuation might make it slightly less, but Binance is strict.
            // If it's dust, we might just fail here.
            console.warn(`⚠️ Warning: Sell value might be below min notional.`);
        }

        params.quantity = adjustedQty;
        console.log(`   🔸 Adjusted Quantity: ${quantity} -> ${adjustedQty} (Step: ${rules.stepSize})`);
    }

    // 3. Security
    if (side === 'BUY' && parseFloat(params.quoteOrderQty) > 5000) throw new Error('SAFETY: Quantity too high for auto-bot');

    return await privateRequest('/api/v3/order', 'POST', params);
};

export const authenticatedRequest = privateRequest;

export default { getAccountBalance, executeOrder, authenticatedRequest };
