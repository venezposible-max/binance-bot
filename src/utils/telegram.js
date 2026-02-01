import axios from 'axios';

const BOT_TOKEN = process.env.TELEGRAM_TOKEN || '8025293831:AAF5H56wm1yAzHwbI9foh7lA-tr8WUwHfd0';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '330749449';

// Cooldown Tracker to prevent spam
// Structure: { 'BTCUSDT': timestamp_of_last_alert }
const alertHistory = {};
const COOLDOWN_MINUTES = 60;

export const sendTelegramAlert = async (symbol, price, signalData) => {
    // 1. Check Cooldown
    const lastAlert = alertHistory[symbol];
    const now = Date.now();

    if (lastAlert && (now - lastAlert) < COOLDOWN_MINUTES * 60 * 1000) {
        // Too soon, skip alert
        return false;
    }

    // 2. Format Message
    const { label, color } = signalData;
    const emoji = label.includes('COMPRA') ? '🟢🚀' : '⚠️';

    // Clean symbol (remove USDT for readability)
    const coin = symbol.replace('USDT', '');

    const message = `
${emoji} **${coin} ALERTA SENTINEL**

💎 **Señal:** ${label}
💰 **Precio:** $${price.toLocaleString()}

_Verificar en Gráfico antes de operar._
    `;

    // 3. Send Request
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });

        // 4. Update History
        alertHistory[symbol] = now;
        console.log(`Alert sent for ${symbol}`);
        return true;
    } catch (error) {
        console.error('Telegram Error Details:', error.response ? error.response.data : error.message);
        return false;
    }
};
export const sendRawTelegram = async (text) => {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text,
            parse_mode: 'Markdown'
        });
        return true;
    } catch (e) {
        console.warn('Telegram send error:', e.message);
        return false;
    }
};

export default { sendTelegramAlert, sendRawTelegram };
