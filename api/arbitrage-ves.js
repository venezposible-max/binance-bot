import axios from 'axios';
import redis from './utils/redisClient.js';

export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            // 1. Fetch Saldo.com.ar Rates (Using 'palpal' system for PayPal to USDT)
            const saldoRes = await axios.get('https://api.saldo.com.ar/json/rates/palpal');
            const saldoData = saldoRes.data;

            // 2. Fetch Binance P2P Rate (Internal BAPI Search)
            // We search for: Asset=USDT, Fiat=VES, TradeType=BUY (to sell our USDT), PublisherType=MERCHANT
            let p2pRate = 0;
            try {
                const p2pPayload = {
                    "asset": "USDT",
                    "fiat": "VES",
                    "merchantCheck": false,
                    "page": 1,
                    "payTypes": ["Maino", "Banesco", "Banco de Venezuela"],
                    "publisherType": null,
                    "rows": 5,
                    "tradeType": "BUY" // We want to BUY VES with our USDT
                };

                const p2pRes = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', p2pPayload);
                if (p2pRes.data && p2pRes.data.data && p2pRes.data.data.length > 0) {
                    p2pRate = parseFloat(p2pRes.data.data[0].adv.price);
                }
            } catch (p2pErr) {
                console.error('P2P Fetch Error:', p2pErr.message);
                // Fallback to a safe estimate if API fails
                p2pRate = 568.5;
            }

            // 3. Get Manual Rates from Redis
            const manualBankRateStr = await redis.get('sentinel_ves_bank_rate');
            const manualBankRate = manualBankRateStr ? parseFloat(manualBankRateStr) : 430.0;

            const manualP2PRateStr = await redis.get('sentinel_ves_p2p_rate');
            const finalP2PRate = manualP2PRateStr ? parseFloat(manualP2PRateStr) : (p2pRate || 568.5);

            res.json({
                success: true,
                data: {
                    saldoar: {
                        usdt_ask: saldoData.usdt?.ask || 0,
                        usdt_bid: saldoData.usdt?.bid || 0,
                        paypal_to_usdt: saldoData.usdt?.ask ? (1 / saldoData.usdt.ask) : 0.939 // Ratio USDT received per 1 PayPal USD
                    },
                    p2p: {
                        rate: finalP2PRate,
                        auto_rate: p2pRate
                    },
                    bank: {
                        rate: manualBankRate
                    },
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    } else if (req.method === 'POST') {
        try {
            const { bankRate, p2pRate } = req.body;

            if (bankRate && !isNaN(bankRate)) {
                await redis.set('sentinel_ves_bank_rate', bankRate.toString());
            }

            if (p2pRate && !isNaN(p2pRate)) {
                await redis.set('sentinel_ves_p2p_rate', p2pRate.toString());
            }

            res.json({ success: true, bankRate, p2pRate });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}
