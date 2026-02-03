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
${emoji} **${coin} ALERTA SENTINEL**

💎 **Señal:** ${label}
💰 **Precio:** $${price.toLocaleString()}

_Verificar en Gráfico antes de operar._
    `;

    // 3. Send via Proxy
    try {
        await axios.post('/api/telegram-proxy', { text: message });

        // 4. Update History
        alertHistory[symbol] = now;
        console.log(`Alert sent for ${symbol}`);
        return true;
    } catch (error) {
        console.error('Telegram Proxy Failed:', error);
        return false;
    }
};

export const sendRawTelegram = async (text) => {
    try {
        await axios.post('/api/telegram-proxy', { text });
        console.log("Raw Telegram Sent");
        return true;
    } catch (e) {
        console.warn('Telegram Proxy error:', e.message);
        return false;
    }
};

export default { sendTelegramAlert, sendRawTelegram };
