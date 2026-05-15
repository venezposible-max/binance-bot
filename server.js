import express from 'express';
import cors from 'cors';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import crypto from 'crypto';

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

// Telegram Config
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
let lastAlertTime = 0;

// Binance API Config
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;

// Cache para no saturar la API
let marketDataCache = {
    makerBuyPrice: 0,
    makerSellPrice: 0,
    spreadPct: 0,
    lastUpdate: 0,
    banks: [] // Lista de mejores precios por banco
};

// Configuración Dinámica
let botConfig = {
    mode: 'SOLO_BDV', // 'SOLO_BDV' o 'MULTI_BANK'
    selectedBanks: ['BancoDeVenezuela']
};

async function sendTelegramAlert(profit, buyPrice, sellPrice, spreadPct) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    
    // Solo enviar 1 alerta cada 5 minutos máximo para no hacer spam
    const now = Date.now();
    if (now - lastAlertTime < 5 * 60 * 1000) return;

    const message = `🚨 *OPORTUNIDAD P2P (BDV)* 🚨\n\n` +
                    `💰 *Ganancia Neta:* +${profit.toFixed(2)} Bs (al mover 60k)\n` +
                    `📊 *Spread:* ${spreadPct}%\n\n` +
                    `🟢 *Crea Anuncio de Compra a:* ${buyPrice} Bs\n` +
                    `🔴 *Crea Anuncio de Venta a:* ${sellPrice} Bs\n\n` +
                    `⏱️ _${new Date().toLocaleTimeString('es-VE', {timeZone: 'America/Caracas'})}_`;

    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
        lastAlertTime = now;
        console.log('✅ Alerta de Telegram enviada!');
    } catch (e) {
        console.error('❌ Error enviando Telegram:', e.message);
    }
}

async function fetchBinanceP2P(tradeType, fiat, asset, customPayTypes = null) {
    const banksToSearch = customPayTypes || botConfig.selectedBanks;
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
            payTypes: banksToSearch,
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
        // --- 1. SCAN PARA EL DASHBOARD (Dinámico) ---
        const makerSellAdv = await fetchBinanceP2P('BUY', FIAT, ASSET);
        const makerBuyAdv = await fetchBinanceP2P('SELL', FIAT, ASSET);

        if (makerSellAdv && makerBuyAdv) {
            const makerSellPrice = parseFloat(makerSellAdv.price);
            const makerBuyPrice = parseFloat(makerBuyAdv.price);
            const myBuyPrice = makerBuyPrice + 0.01;
            const mySellPrice = makerSellPrice - 0.01;
            const spreadBruto = mySellPrice - myBuyPrice;
            const spreadPct = (spreadBruto / myBuyPrice) * 100;

            const formatBanks = (adv, selectedBanks) => {
                if (botConfig.mode === 'SOLO_BDV') return 'Banco de Venezuela';
                const matched = adv.tradeMethods
                    .map(m => m.identifier)
                    .filter(id => selectedBanks.includes(id));
                return matched.length > 0 ? matched.join(', ') : adv.tradeMethods.map(m => m.identifier).join(', ');
            };

            marketDataCache = {
                makerBuyPrice: myBuyPrice.toFixed(2),
                makerSellPrice: mySellPrice.toFixed(2),
                spreadBruto: spreadBruto.toFixed(2),
                spreadPct: spreadPct.toFixed(2),
                lastUpdate: Date.now(),
                topBuyAdBank: formatBanks(makerBuyAdv, botConfig.selectedBanks),
                topSellAdBank: formatBanks(makerSellAdv, botConfig.selectedBanks)
            };
            
            console.log(`[DASHBOARD] Compra Maker: ${myBuyPrice.toFixed(2)} | Venta Maker: ${mySellPrice.toFixed(2)} | Spread: ${spreadPct.toFixed(2)}%`);
        }

        // --- 2. SCAN PARA TELEGRAM (Estrictamente BDV) ---
        let telMakerSell, telMakerBuy;
        if (botConfig.mode === 'SOLO_BDV') {
            telMakerSell = makerSellAdv; // Reutilizamos si ya es BDV
            telMakerBuy = makerBuyAdv;
        } else {
            telMakerSell = await fetchBinanceP2P('BUY', FIAT, ASSET, ['BancoDeVenezuela']);
            telMakerBuy = await fetchBinanceP2P('SELL', FIAT, ASSET, ['BancoDeVenezuela']);
        }

        if (telMakerSell && telMakerBuy) {
            const telMyBuyPrice = parseFloat(telMakerBuy.price) + 0.01;
            const telMySellPrice = parseFloat(telMakerSell.price) - 0.01;
            const telSpreadBruto = telMySellPrice - telMyBuyPrice;
            const telSpreadPct = (telSpreadBruto / telMyBuyPrice) * 100;
            const telProfit60k = (60000 / telMyBuyPrice) * telSpreadBruto;
            
            // Lógica de Disparo de Alerta Telegram (Solo BDV)
            if (telProfit60k >= 50 && telSpreadPct > 0.2) {
                sendTelegramAlert(telProfit60k, telMyBuyPrice.toFixed(2), telMySellPrice.toFixed(2), telSpreadPct.toFixed(2));
            }
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
        data: marketDataCache,
        config: botConfig
    });
});

app.post('/api/arbitrage/config', (req, res) => {
    const { mode, selectedBanks } = req.body;
    if (mode === 'SOLO_BDV') {
        botConfig.mode = 'SOLO_BDV';
        botConfig.selectedBanks = ['BancoDeVenezuela'];
    } else if (mode === 'MULTI_BANK' && Array.isArray(selectedBanks)) {
        botConfig.mode = 'MULTI_BANK';
        botConfig.selectedBanks = selectedBanks;
    }
    
    // Forzar actualización inmediata con nueva config
    updateMarketData();
    
    res.json({ success: true, config: botConfig });
});

// BÓVEDA SECRETA: Historial de P2P
app.post('/api/arbitrage/vault', async (req, res) => {
    const { pin } = req.body;
    if (pin !== '228922') {
        return res.status(401).json({ success: false, message: 'PIN Incorrecto' });
    }

    if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
        return res.status(500).json({ success: false, message: 'Faltan credenciales de API en .env' });
    }

    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}&rows=50`; // Últimos 50 trades
    const signature = crypto.createHmac('sha256', BINANCE_API_SECRET).update(queryString).digest('hex');
    
    try {
        const response = await axios.get(`https://api.binance.com/sapi/v1/c2c/orderMatch/listUserOrderHistory?${queryString}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': BINANCE_API_KEY }
        });
        
        // Filtrar solo las completadas
        const completedTrades = (response.data.data || []).filter(t => t.orderStatus === 'COMPLETED');
        
        res.json({ success: true, data: completedTrades });
    } catch (e) {
        console.error('Error en Bóveda:', e.response ? e.response.data : e.message);
        res.status(500).json({ success: false, message: 'Error consultando Binance' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('=============================================');
    console.log(`🤖 ARBITRAJE BOT (P2P Radar) ONLINE -> Puerto ${PORT}`);
    console.log('=============================================');
});
