import axios from 'axios';

async function checkSniperOpportunities() {
    const symbol = 'BTCUSDT';
    const threshold = 150000; // 150k USDT
    const url = `https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&limit=5000`;

    try {
        console.log(`🔎 Analizando los últimos 1000 trades agrupados de ${symbol}...`);
        const res = await axios.get(url);
        const trades = res.data;

        let found = 0;
        let largest = 0;

        trades.forEach(t => {
            const price = parseFloat(t.p);
            const qty = parseFloat(t.q);
            const volume = price * qty;

            if (volume > largest) largest = volume;

            if (volume > threshold) {
                const time = new Date(t.T).toLocaleTimeString();
                console.log(`🎯 OPORTUNIDAD DETECTADA: $${volume.toLocaleString()} a las ${time} (Precio: $${price})`);
                found++;
            }
        });

        if (found === 0) {
            console.log(`❌ No se encontraron ballenas de +$150k en los últimos 1000 trades.`);
            console.log(`🐋 El trade más grande detectado fue de: $${largest.toLocaleString()}`);
        } else {
            console.log(`✅ Se encontraron ${found} oportunidades potenciales.`);
        }

    } catch (e) {
        console.error('Error al consultar la API de Binance:', e.message);
    }
}

checkSniperOpportunities();
