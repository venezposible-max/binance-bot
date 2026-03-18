const axios = require('axios');
const URL = 'https://binance-bot-production-28a6.up.railway.app/api/get-status?mode=LIVE';

async function check() {
    try {
        const res = await axios.get(URL);
        const data = res.data;
        console.log("ACTIVE TRADES:", JSON.stringify(data.active, null, 2));
    } catch (e) {
        console.error("Error:", e.message);
    }
}

check();
