import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;

async function test() {
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}&rows=2`;
    const signature = crypto.createHmac('sha256', API_SECRET).update(queryString).digest('hex');
    
    try {
        const response = await axios.get(`https://api.binance.com/sapi/v1/c2c/orderMatch/listUserOrderHistory?${queryString}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': API_KEY }
        });
        
        console.log(response.data.data[0]);
    } catch (e) {
        console.error(e.message);
    }
}
test();
