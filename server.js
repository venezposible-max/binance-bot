import express from 'express';
import cors from 'cors';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de Búsqueda P2P
const FIAT = 'VES';
const ASSET = 'USDT';
const TRADE_TYPES = ['BUY', 'SELL']; // BUY = Anuncios de Venta (Maker SELL). SELL = Anuncios de Compra (Maker BUY).

// Cache para no saturar la API
let marketDataCache = {
    makerBuyPrice: 0,
    makerSellPrice: 0,
    spreadPct: 0,
    lastUpdate: 0,
    banks: [] // Lista de mejores precios por banco
};

async function fetchBinanceP2P(tradeType, fiat, asset) {
    try {
        const response = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
            fiat: fiat,
            page: 1,
            rows: 10,
            tradeType: tradeType,
            asset: asset,
            countries: [],
            proMerchantAds: false,
            shieldMerchantAds: false,
            publisherType: null,
            payTypes: ["Mercantil", "Banesco", "BancoDeVenezuela", "PagoMovilVenezuela"],
            transAmount: "60000",
            classifies: ['mass', 'profession']
        }, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            }
        });
        
        if (response.data && response.data.data && response.data.data.length > 0) {
            const ads = response.data.data;
            if (ads.length === 1) return ads[0].adv;
            
            // Filtro Anti-Outlier: Buscar el primer anuncio que esté cerca del siguiente (mercado real)
            for (let i = 0; i < ads.length - 1; i++) {
                const currentPrice = parseFloat(ads[i].adv.price);
                const nextPrice = parseFloat(ads[i+1].adv.price);
                
                // Si la diferencia con el siguiente competidor es menor a 0.5%, es un precio real
                const diffPct = Math.abs(currentPrice - nextPrice) / nextPrice;
                if (diffPct < 0.005) {
                    return ads[i].adv;
                }
            }
            // Si no encuentra cluster, ignora el primero que suele ser un outlier promocionado
            return ads[1].adv || ads[0].adv;
        }
        return null;
    } catch (error) {
        console.error(`Error fetching P2P data for ${tradeType}:`, error.message);
        return null;
    }
}

async function updateMarketData() {
    try {
        // "BUY" tab = Taker buys from Maker. So this is the lowest price a Maker is selling at.
        const makerSellAdv = await fetchBinanceP2P('BUY', FIAT, ASSET);
        // "SELL" tab = Taker sells to Maker. So this is the highest price a Maker is buying at.
        const makerBuyAdv = await fetchBinanceP2P('SELL', FIAT, ASSET);

        if (makerSellAdv && makerBuyAdv) {
            const makerSellPrice = parseFloat(makerSellAdv.price);
            const makerBuyPrice = parseFloat(makerBuyAdv.price);
            
            // Para ganar, como Maker debes comprar barato y vender caro
            // Tu precio de compra sería (makerBuyPrice + 0.01) para estar de primero
            // Tu precio de venta sería (makerSellPrice - 0.01) para estar de primero
            const myBuyPrice = makerBuyPrice + 0.01;
            const mySellPrice = makerSellPrice - 0.01;
            
            const spreadBruto = mySellPrice - myBuyPrice;
            const spreadPct = (spreadBruto / myBuyPrice) * 100;

            marketDataCache = {
                makerBuyPrice: myBuyPrice.toFixed(2),
                makerSellPrice: mySellPrice.toFixed(2),
                spreadBruto: spreadBruto.toFixed(2),
                spreadPct: spreadPct.toFixed(2),
                lastUpdate: Date.now(),
                topBuyAdBank: makerBuyAdv.tradeMethods[0]?.identifier || 'Varios',
                topSellAdBank: makerSellAdv.tradeMethods[0]?.identifier || 'Varios'
            };
            
            console.log(`[P2P] Compra Maker: ${myBuyPrice.toFixed(2)} | Venta Maker: ${mySellPrice.toFixed(2)} | Spread: ${spreadPct.toFixed(2)}%`);
        }
    } catch (e) {
        console.error('Error in updateMarketData:', e.message);
    }
}

// Iniciar ciclo de escaneo cada 15 segundos
setInterval(updateMarketData, 15000);
updateMarketData(); // Llamada inicial

// Endpoints de la API
app.get('/api/arbitrage/status', (req, res) => {
    res.json({
        success: true,
        data: marketDataCache
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('=============================================');
    console.log(`🤖 ARBITRAJE BOT (P2P Radar) ONLINE -> Puerto ${PORT}`);
    console.log('=============================================');
});
