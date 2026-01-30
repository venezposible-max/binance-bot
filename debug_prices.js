import axios from 'axios';

const checkPrices = async () => {
    const symbol = 'BCH';
    console.log(`Checking prices for ${symbol}...`);

    try {
        // 1. Binance Global (USDT)
        console.log("--- Binance Global (api.binance.com) ---");
        try {
            const resGlobal = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`);
            console.log(`Global ${symbol}USDT: $${resGlobal.data.price}`);
        } catch (e) {
            console.log("Global Failed:", e.message);
        }

        // 2. Binance US (USDT)
        console.log("--- Binance US (api.binance.us) ---");
        try {
            const resUsUsdt = await axios.get(`https://api.binance.us/api/v3/ticker/price?symbol=${symbol}USDT`);
            console.log(`US ${symbol}USDT: $${resUsUsdt.data.price}`);
        } catch (e) {
            console.log("US USDT Failed:", e.message);
        }

        // 3. Binance US (USD)
        try {
            const resUsUsd = await axios.get(`https://api.binance.us/api/v3/ticker/price?symbol=${symbol}USD`);
            console.log(`US ${symbol}USD: $${resUsUsd.data.price}`);
        } catch (e) {
            console.log("US USD Failed:", e.message);
        }

    } catch (error) {
        console.error("Main Error:", error);
    }
};

checkPrices();
