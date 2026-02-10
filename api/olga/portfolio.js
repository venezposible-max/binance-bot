
import binanceClient from '../utils/binance-client.js';
import axios from 'axios';

export default async function handler(req, res) {
    try {
        console.log('💰 OLGA PORTFOLIO CHECK INITIATED');

        const responseData = {
            total_usd: "0.00",
            pnl_today: "0.00",
            positions_count: 0,
            positions: [],
            spot_details: []
        };

        // 1. SPOT ACCOUNT SNAPSHOT
        // We use the account endpoint to get all balances
        const spotData = await binanceClient.authenticatedRequest('/api/v3/account');

        let spotTotalUSDT = 0;
        const significantBalances = [];

        // Simple estimation: Sum USDT + BUSD + USDC directly.
        // For BTC/ETH, we would need current prices.
        // Let's try to fetch ticker prices for major assets to be more accurate.
        const prices = {};
        try {
            const tickerRes = await axios.get('https://api.binance.com/api/v3/ticker/price');
            tickerRes.data.forEach(t => { prices[t.symbol] = parseFloat(t.price); });
        } catch (e) { console.warn('Price fetch failed, using raw balances'); }

        spotData.balances.forEach(b => {
            const total = parseFloat(b.free) + parseFloat(b.locked);
            if (total > 0) {
                let usdtValue = 0;
                if (b.asset === 'USDT' || b.asset === 'USDC' || b.asset === 'FDUSD') {
                    usdtValue = total;
                } else {
                    // Try to find PAIR-USDT
                    const pair = `${b.asset}USDT`;
                    if (prices[pair]) {
                        usdtValue = total * prices[pair];
                    }
                }

                if (usdtValue > 1) { // Only count dust > $1
                    spotTotalUSDT += usdtValue;
                    significantBalances.push({ asset: b.asset, qty: total.toFixed(4), usd: usdtValue.toFixed(2) });
                }
            }
        });

        responseData.spot_details = significantBalances;

        // 2. FUTURES ACCOUNT (If enabled/accessible)
        // We need to sign a request to FAPI. binance-client might default to Spot URL base.
        // We need to construct a custom FAPI request manually or extend the client.
        // For simplicity, let's try to reuse the signing logic but force the FAPI domain if possible.
        // But binance-client 'privateRequest' uses 'getBaseUrl()'.

        // Let's implement a manual FAPI call here reusing the secrets from process.env
        try {
            const crypto = await import('crypto');
            const querystring = await import('querystring');

            const apiKey = process.env.BINANCE_API_KEY;
            const apiSecret = process.env.BINANCE_API_SECRET;
            const fapiBase = 'https://fapi.binance.com';

            if (apiKey && apiSecret) {
                const ts = Date.now();
                const q = `timestamp=${ts}`;
                const sig = crypto.createHmac('sha256', apiSecret).update(q).digest('hex');

                const fAccount = await axios.get(`${fapiBase}/fapi/v2/account?${q}&signature=${sig}`, {
                    headers: { 'X-MBX-APIKEY': apiKey }
                });

                const fData = fAccount.data;
                const futBal = parseFloat(fData.totalWalletBalance || 0);
                const futUnrealized = parseFloat(fData.totalUnrealizedProfit || 0);

                responseData.pnl_today = futUnrealized.toFixed(2);

                // Get Positions
                if (fData.positions) {
                    const activePos = fData.positions.filter(p => parseFloat(p.positionAmt) !== 0);
                    responseData.positions_count = activePos.length;
                    responseData.positions = activePos.map(p => ({
                        symbol: p.symbol,
                        size: p.positionAmt,
                        pnl: p.unrealizedProfit,
                        leverage: p.leverage
                    }));
                }

                // Total is Spot + Futures Equity
                // Note: futures 'totalWalletBalance' is the margin balance.
                // We sum Spot USDT Value + Futures Wallet Balance + Unrealized PnL
                const total = spotTotalUSDT + futBal + futUnrealized;
                responseData.total_usd = total.toFixed(2);

            } else {
                // If only Spot keys are valid or Futures disabled, just show Spot
                responseData.total_usd = spotTotalUSDT.toFixed(2);
            }

        } catch (fErr) {
            console.warn('Futures fetch failed (maybe permissions?):', fErr.message);
            // Fallback to just Spot
            responseData.total_usd = spotTotalUSDT.toFixed(2);
        }

        res.json(responseData);

    } catch (error) {
        console.error('Olga Portfolio Error:', error);
        res.status(500).json({ error: 'Failed to fetch portfolio', details: error.message });
    }
}
