
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

/**
 * SERVER-SIDE TELEGRAM UTILITY
 * Direct access to Telegram API. No local proxy needed.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export const sendServerTelegram = async (text) => {
    if (!BOT_TOKEN || !CHAT_ID) {
        console.warn('⚠️ Telegram Credentials missing in Server Environment');
        return false;
    }

    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: CHAT_ID,
            text: text,
            parse_mode: 'Markdown'
        });
        console.log("✅ Telegram Alert Sent (Server Direct)");
        return true;
    } catch (error) {
        console.error("❌ Telegram Send Error:", error?.response?.data || error.message);
        return false;
    }
};
