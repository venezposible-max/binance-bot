import axios from 'axios';

// Proxy Function to send Telegram Messages from Backend (Avoids CORS)
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { text, chatId } = req.body;

    // Environment Variables (Server Side)
    const BOT_TOKEN = process.env.TELEGRAM_TOKEN || '8025293831:AAF5H56wm1yAzHwbI9foh7lA-tr8WUwHfd0';
    const CHAT_ID = chatId || process.env.TELEGRAM_CHAT_ID || '330749449';

    if (!text) {
        return res.status(400).json({ error: 'Missing text content' });
    }

    try {
        const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: text,
            parse_mode: 'Markdown'
        });

        return res.json({ success: true, result: response.data });
    } catch (error) {
        console.error('Telegram Proxy Error:', error.response ? error.response.data : error.message);
        return res.status(500).json({
            error: 'Failed to send message',
            details: error.response ? error.response.data : error.message
        });
    }
}
