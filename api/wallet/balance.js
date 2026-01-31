import binanceClient from '../utils/binance-client.js';

export default async function handler(req, res) {
    try {
        const balanceData = await binanceClient.getAccountBalance('USDT');
        res.status(200).json(balanceData);
    } catch (error) {
        console.error('Balance Fetch Error:', error.message);
        res.status(500).json({
            available: 0,
            total: 0,
            error: 'Failed to fetch Real Balance. Check API Keys.'
        });
    }
}
