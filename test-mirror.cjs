const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function testMirror() {
    try {
        console.log('--- Iniciando Prueba de Espejo ---');
        const response = await axios.get('https://t.me/s/bancocompradedivisa', { 
            headers: { 'User-Agent': 'Mozilla/5.0' } 
        });
        const $ = cheerio.load(response.data);
        
        const lastMessages = $('.tgme_widget_message_wrap').slice(-3);
        console.log(`Encontrados ${lastMessages.length} mensajes recientes.`);

        for (let i = 0; i < lastMessages.length; i++) {
            const msg = $(lastMessages[i]);
            const text = msg.find('.tgme_widget_message_text').text().trim();
            if (text) {
                console.log(`Enviando mensaje ${i+1}...`);
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: TELEGRAM_CHAT_ID,
                    text: `📢 *PRUEBA DE RÉPLICA INMEDIATA* 📢\n\n${text}`,
                    parse_mode: 'Markdown'
                });
            }
        }
        console.log('--- Prueba Finalizada con Éxito ---');
    } catch (e) {
        console.error('Error en la prueba:', e.message);
    }
}

testMirror();
