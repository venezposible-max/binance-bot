import axios from 'axios';

async function test() {
    try {
        const response = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
            fiat: 'VES',
            page: 1,
            rows: 5,
            tradeType: 'BUY',
            asset: 'USDT',
            countries: [],
            proMerchantAds: false,
            shieldMerchantAds: false,
            publisherType: null,
            payTypes: [],
            transAmount: "60000",
            classifies: ['mass', 'profession']
        }, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            }
        });
        
        if (response.data && response.data.data) {
            const ad = response.data.data[0];
            console.log(ad.adv.tradeMethods.map(t => t.identifier));
            
            // Also test with 'BancoDeVenezuela'
            const response2 = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
                fiat: 'VES',
                page: 1,
                rows: 5,
                tradeType: 'BUY',
                asset: 'USDT',
                countries: [],
                proMerchantAds: false,
                shieldMerchantAds: false,
                publisherType: null,
                payTypes: ["BancoDeVenezuela"],
                transAmount: "60000",
                classifies: ['mass', 'profession']
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0'
                }
            });
            console.log('With BancoDeVenezuela filter:', response2.data.data[0]?.adv.tradeMethods.map(t => t.identifier));

        }
    } catch (e) {
        console.error(e.message);
    }
}
test();
