import crypto from 'crypto';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.BINANCE_API_KEY;
const apiSecret = process.env.BINANCE_API_SECRET;
const baseURL = 'https://api.binance.com';

async function checkFiatPayments() {
  const timestamp = Date.now();
  // Probando GET /sapi/v1/fiat/payments
  const queryString = `transactionType=0&timestamp=${timestamp}`;
  const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
  const url = `${baseURL}/sapi/v1/fiat/payments?${queryString}&signature=${signature}`;

  try {
    const res = await axios.get(url, { headers: { 'X-MBX-APIKEY': apiKey } });
    console.log("=== FIAT PAYMENTS ===");
    res.data.data = res.data.data?.slice(0, 3); // Solo mostrar 3
    console.log(JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.log("Error checking /fiat/payments:", e.response ? e.response.data : e.message);
  }
}
checkFiatPayments();
