import axios from 'axios';
import * as cheerio from 'cheerio';

async function scrapeTelegramChannel() {
    try {
        const url = 'https://t.me/s/BancaVenezolana';
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const $ = cheerio.load(data);
        const messages = [];

        $('.tgme_widget_message_text').each((i, el) => {
            messages.push($(el).text().trim());
        });

        // Ver los últimos 5 mensajes para depuración
        console.log("Últimos mensajes detectados:");
        messages.slice(-5).forEach((m, i) => console.log(`${i+1}: ${m}`));

        // Buscar información de intervención
        let interventionInfo = {
            status: 'Cerrado', // Por defecto
            rate: '---',
            lastUpdate: 'No detectado'
        };

        // Recorrer de atrás hacia adelante para encontrar el estado más reciente
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i].toLowerCase();
            
            if (msg.includes('intervención') || msg.includes('intervencion')) {
                if (msg.includes('vta') || msg.includes('venta') || msg.includes('digital')) {
                    interventionInfo.status = 'Abierto';
                } else if (msg.includes('cerrada') || msg.includes('finalizó') || msg.includes('finalizo')) {
                    interventionInfo.status = 'Cerrado';
                }
                
                // Intentar extraer tasa
                const tasaMatch = msg.match(/tasa:\s*bs\.\s*([\d,.]+)/i);
                if (tasaMatch) {
                    interventionInfo.rate = tasaMatch[1];
                }
                
                interventionInfo.lastUpdate = new Date().toLocaleTimeString();
                break; // Encontramos la más reciente
            }
        }

        console.log("\nResultado del análisis:");
        console.log(interventionInfo);

        return interventionInfo;

    } catch (error) {
        console.error('Error scraping Telegram:', error.message);
    }
}

scrapeTelegramChannel();
