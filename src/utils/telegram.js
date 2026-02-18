import axios from 'axios';

// Client-side utility that now talks to our Backend Proxy
// This avoids CORS errors and hides the token on the client.

// Cooldown Tracker
const alertHistory = {};
const COOLDOWN_MINUTES = 60;

export const sendTelegramAlert = async (symbol, price, signalData) => {
    // 1. Check Cooldown
    const lastAlert = alertHistory[symbol];
    const now = Date.now();

    if (lastAlert && (now - lastAlert) < COOLDOWN_MINUTES * 60 * 1000) {
        return false;
    }

    // 2. Format Message
    const { label, color } = signalData;
    const emoji = label.includes('COMPRA') || label.includes('BUY') ? '🟢🚀' : '⚠️';
    const coin = symbol.replace('USDT', '');

    const message = `
${emoji} <b>${coin} ALERTA SENTINEL</b>

💎 <b>Señal:</b> ${label}
💰 <b>Precio:</b> $${price.toLocaleString()}

<i>Verificar en Gráfico antes de operar.</i>
    `;

    // 3. Send via Proxy
    try {
        const baseURL = getBaseUrl();
        await axios.post(`${baseURL}/api/telegram-proxy`, { text: message });

        // 4. Update History
        alertHistory[symbol] = now;
        console.log(`Alert sent for ${symbol}`);
        return true;
    } catch (error) {
        console.error('Telegram Proxy Failed:', error);
        return false;
    }
};

// Helper to get Base URL (Isomorphic: Works in Browser and Node)
const getBaseUrl = () => {
    if (typeof window !== 'undefined') return ''; // Browser: use relative path
    const port = process.env.PORT || 8080;
    return `http://127.0.0.1:${port}`; // Server: use localhost
};

export const sendRawTelegram = async (text) => {
    try {
        const baseURL = getBaseUrl();
        await axios.post(`${baseURL}/api/telegram-proxy`, { text });
        console.log("Raw Telegram Sent");
        return true;
    } catch (e) {
        console.warn('Telegram Proxy error:', e.message);
        return false;
    }
};

export default { sendTelegramAlert, sendRawTelegram };
