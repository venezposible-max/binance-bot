import 'dotenv/config';
import { sendRawTelegram } from './src/utils/telegram.js';

async function test() {
    console.log('📨 Sending Test Message...');
    try {
        await sendRawTelegram("🔔 **TEST DE CONEXIÓN**\n\nEl Sentinel está activo y conectado.\nSi lees esto, las notificaciones funcionan. 🚀");
        console.log('✅ Message Sent!');
    } catch (e) {
        console.error('❌ Failed:', e.message);
    }
}

test();
