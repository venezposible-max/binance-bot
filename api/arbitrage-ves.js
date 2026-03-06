import axios from 'axios';
const BANKS = [
    { name: 'Banesco', codes: ['Banesco'] },
    { name: 'Mercantil', codes: ['Mercantil'] },
    { name: 'BDV', codes: ['Banco de Venezuela'] },
    { name: 'Pago Movil', codes: ['Pago Movil'] }
];

export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            // Fetch P2P Rates for each bank
            const rates = await Promise.all(BANKS.map(async (bank) => {
                try {
                    const payload = {
                        "asset": "USDT",
                        "fiat": "VES",
                        "merchantCheck": false,
                        "page": 1,
                        "payTypes": bank.codes,
                        "publisherType": null,
                        "rows": 1,
                        "tradeType": "BUY" // Sell our USDT to get VES
                    };
                    const resBuy = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', payload);

                    const payloadSell = { ...payload, "tradeType": "SELL" }; // Buy USDT with VES
                    const resSell = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', payloadSell);

                    return {
                        name: bank.name,
                        sell: resBuy.data?.data?.[0]?.adv?.price || 0, // Price to sell USDT
                        buy: resSell.data?.data?.[0]?.adv?.price || 0  // Price to buy USDT
                    };
                } catch (e) {
                    return { name: bank.name, sell: 0, buy: 0 };
                }
            }));

            res.json({
                success: true,
                data: {
                    rates,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

