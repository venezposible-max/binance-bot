import axios from 'axios';

const checkCoinbase = async () => {
    try {
        const symbol = 'BCH';
        const res = await axios.get(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`);
        console.log(`Coinbase ${symbol}-USD: $${res.data.data.amount}`);
    } catch (e) {
        console.log("Coinbase Failed:", e.message);
    }
};

checkCoinbase();
