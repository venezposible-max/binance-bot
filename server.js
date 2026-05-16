import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
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
    banks: [], // Lista de mejores precios por banco
    bcv: {
        status: 'Cerrado',
        rate: '---',
        lastUpdate: 'Esperando datos...'
    },
    prediction: {
        sentiment: 'NEUTRAL',
        confidence: 0,
        direction: 'ESTABLE'
    },
    exhaustion: {
        imminent: false,
        adId: null,
        secondsLeft: 0,
        rate: 0,
        status: 'ESPERANDO...'
    },
    topAds: {
        buy: [], // Para calcular capital por delante
        sell: []
    }
};

let marketHistory = []; // Para análisis predictivo (últimos 20 registros)
let liquidityTracker = {}; // Para medir velocidad de agotamiento de la competencia

// Configuración Dinámica
let botConfig = {
    mode: 'SOLO_BDV', // 'SOLO_BDV' o 'MULTI_BANK'
    selectedBanks: ['BancoDeVenezuela']
};

async function scrapeBCV() {
    try {
        const url = 'https://t.me/s/BancaVenezolana';
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const $ = cheerio.load(data);
        const messages = [];

        $('.tgme_widget_message_text').each((i, el) => {
            messages.push($(el).text().trim());
        });

        let interventionInfo = {
            status: 'Cerrado',
            rate: '---',
            activeBanks: [], // Bancos con intervención o menudeo activo
            lastUpdate: new Date().toLocaleTimeString('es-VE', {timeZone: 'America/Caracas'})
        };

        const bankKeywords = [
            'bdv', 'banco de venezuela', 'banesco', 'mercantil', 'provincial', 'bancamiga', 
            'bnc', 'tesoro', 'banco del tesoro', 'activo', 'banco activo', 'plaza', 'banco plaza', '100%'
        ];

        // Recorrer los últimos 10 mensajes para ver el panorama actual
        const recentMessages = messages.slice(-15);
        
        recentMessages.forEach(msgOriginal => {
            const msg = msgOriginal.toLowerCase();
            
            // 1. Detección de Intervención General
            if (msg.includes('intervención') || msg.includes('intervencion')) {
                if (msg.includes('vta') || msg.includes('venta') || msg.includes('digital')) {
                    interventionInfo.status = 'Abierto';
                }
                const tasaMatch = msg.match(/tasa:\s*bs\.\s*([\d,.]+)/i);
                if (tasaMatch) interventionInfo.rate = tasaMatch[1];
            }

            // 2. Detección de Bancos Específicos y Menudeo
            if (msg.includes('activo') || msg.includes('abierto') || msg.includes('vta') || msg.includes('venta')) {
                bankKeywords.forEach(bank => {
                    if (msg.includes(bank)) {
                        let type = 'Intervención';
                        if (msg.includes('menudeo')) type = 'Menudeo';
                        
                        const bankName = bank.toUpperCase();
                        if (!interventionInfo.activeBanks.some(b => b.name === bankName && b.type === type)) {
                            interventionInfo.activeBanks.push({ name: bankName, type: type });
                        }
                    }
                });
            }
        });

        // Si no hay bancos detectados pero el status general es Abierto, poner "General"
        if (interventionInfo.status === 'Abierto' && interventionInfo.activeBanks.length === 0) {
            interventionInfo.activeBanks.push({ name: 'SISTEMA BANCARIO', type: 'Intervención' });
        }

        marketDataCache.bcv = interventionInfo;
        console.log(`📡 BCV Scraper: ${interventionInfo.status} | Bancos: ${interventionInfo.activeBanks.map(b => b.name).join(', ')}`);

    } catch (error) {
        console.error('Error scraping BCV:', error.message);
    }
}

async function sendTelegramAlert(profit, buyPrice, sellPrice, spreadPct) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    
    // Solo enviar 1 alerta cada 5 minutos máximo para no hacer spam
    const now = Date.now();
    if (now - lastAlertTime < 5 * 60 * 1000) return;

    const message = `🚨 *OPORTUNIDAD P2P (BDV)* 🚨\n\n` +
                    `💰 *Ganancia Neta:* +${profit.toFixed(2)} Bs (al mover 60k)\n` +
                    `📊 *Spread:* ${spreadPct}%\n\n` +
                    `🟢 *Crea Compra a:* ${buyPrice} Bs\n` +
                    `🔴 *Crea Venta a:* ${sellPrice} Bs\n\n` +
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
            rows: 20, // Aumentado a 20 para encontrar a Silverrabit
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
            return response.data.data; // Retornar la lista completa para análisis de muros
        }
        return [];
    } catch (error) {
        console.error(`Error fetching P2P data for ${tradeType}:`, error.message);
        return [];
    }
}

function calculatePrediction() {
    if (marketHistory.length < 3) return;

    const latest = marketHistory[marketHistory.length - 1];
    
    let confidence = 60;
    let sentiment = 'NEUTRAL';
    let direction = 'ESTABLE';

    // 1. Análisis de Tendencia de Precio (Venta Maker)
    const prices = marketHistory.map(h => h.sellPrice);
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const priceDiff = lastPrice - firstPrice;

    if (priceDiff > 0.02) {
        direction = 'ALCISTA 📈';
        confidence += 15;
    } else if (priceDiff < -0.02) {
        direction = 'BAJISTA 📉';
        confidence += 15;
    }

    // 2. Análisis de Liquidez (Muros)
    const buyWall = latest.buyWall;
    const sellWall = latest.sellWall;
    
    if (buyWall > sellWall * 1.3) {
        sentiment = 'FUERTE APOYO 🟢';
        confidence += 10;
    } else if (sellWall > buyWall * 1.3) {
        sentiment = 'PRESIÓN DE VENTA 🔴';
        confidence += 10;
    }

    // 3. Normalizar Confianza
    if (confidence > 98) confidence = 98;

    marketDataCache.prediction = {
        sentiment,
        confidence: Math.round(confidence),
        direction
    };
}

async function updateMarketData() {
    try {
        const threshold = 100; // Un "muro" es un anuncio con al menos 100 USDT

        // --- 1. SCAN PARA EL DASHBOARD (Dinámico) ---
        const buyAds = await fetchBinanceP2P('BUY', FIAT, ASSET); // Vendedores
        const sellAds = await fetchBinanceP2P('SELL', FIAT, ASSET); // Compradores

        if (buyAds.length > 0 && sellAds.length > 0) {
            // Encontrar el "Muro" en las compras (donde nosotros queremos vender caro)
            const makerSellAdv = buyAds.find(a => parseFloat(a.adv.surplusAmount) >= threshold)?.adv || buyAds[0]?.adv;
            
            // Encontrar el "Muro" en las ventas (donde nosotros queremos comprar barato)
            const makerBuyAdv = sellAds.find(a => parseFloat(a.adv.surplusAmount) >= threshold)?.adv || sellAds[0]?.adv;

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
                    ...marketDataCache,
                    makerBuyPrice: myBuyPrice.toFixed(2),
                    makerSellPrice: mySellPrice.toFixed(2),
                    spreadBruto: spreadBruto.toFixed(2),
                    spreadPct: spreadPct.toFixed(2),
                    lastUpdate: Date.now(),
                    topBuyAdBank: formatBanks(makerBuyAdv, botConfig.selectedBanks),
                    topSellAdBank: formatBanks(makerSellAdv, botConfig.selectedBanks),
                    buyWallVolume: parseFloat(makerBuyAdv.surplusAmount).toFixed(2),
                    sellWallVolume: parseFloat(makerSellAdv.surplusAmount).toFixed(2),
                    topAds: {
                        buy: sellAds.slice(0, 20).map(a => ({ price: parseFloat(a.adv.price), vol: parseFloat(a.adv.surplusAmount), nick: a.advertiser.nickName })),
                        sell: buyAds.slice(0, 20).map(a => ({ price: parseFloat(a.adv.price), vol: parseFloat(a.adv.surplusAmount), nick: a.advertiser.nickName }))
                    },
                    // PLAN B: Detección por Nickname (Insensible a mayúsculas)
                    silverMatch: [...sellAds, ...buyAds].find(a => 
                        a.advertiser.nickName.toLowerCase().trim() === 'silverrabit'
                    )
                };

                // Log para debug (ver quiénes están en el top)
                console.log('[DEBUG] Nombres en el Top:', [...sellAds.slice(0,5), ...buyAds.slice(0,5)].map(a => a.advertiser.nickName).join(', '));

                if (marketDataCache.silverMatch) {
                    const sm = marketDataCache.silverMatch;
                    marketDataCache.fallbackAd = {
                        id: sm.adv.advNo,
                        price: parseFloat(sm.adv.price),
                        type: sm.adv.tradeType,
                        min: parseFloat(sm.adv.minSingleTransAmount),
                        max: parseFloat(sm.adv.maxSingleTransAmount),
                        surplus: parseFloat(sm.adv.surplusAmount),
                        status: 'ON (Vía Radar Público)'
                    };
                } else {
                    marketDataCache.fallbackAd = null;
                }

                // Actualizar Historial para Predicción
                marketHistory.push({
                    sellPrice: makerSellPrice,
                    buyPrice: makerBuyPrice,
                    buyWall: parseFloat(makerBuyAdv.surplusAmount),
                    sellWall: parseFloat(makerSellAdv.surplusAmount),
                    time: Date.now()
                });
                if (marketHistory.length > 20) marketHistory.shift();
                
                calculatePrediction();
                
                // --- 3. ANÁLISIS DE AGOTAMIENTO (SENTINEL) ---
                const topAd = buyAds[0]; // El competidor #1 en ventas
                if (topAd) {
                    const adId = topAd.adv.advNo;
                    const currentVol = parseFloat(topAd.adv.surplusAmount);
                    const now = Date.now();
                    
                    if (liquidityTracker[adId]) {
                        const firstEntry = liquidityTracker[adId].first;
                        const totalTimeDiff = (now - firstEntry.time) / 1000;
                        const totalVolDiff = firstEntry.vol - currentVol;
                        
                        if (totalVolDiff > 0 && totalTimeDiff > 2) { // Reducido a 2s para respuesta rápida
                            const avgRate = totalVolDiff / totalTimeDiff;
                            const secondsLeft = currentVol / avgRate;
                            
                            marketDataCache.exhaustion = {
                                imminent: secondsLeft < 300,
                                adId: adId,
                                secondsLeft: Math.round(secondsLeft),
                                rate: avgRate.toFixed(2),
                                status: secondsLeft < 120 ? '⚠️ AGOTÁNDOSE' : 'OBSERVANDO VENTAS'
                            };
                        } else if (totalVolDiff === 0) {
                            marketDataCache.exhaustion.status = totalTimeDiff > 20 ? 'MERCADO PAUSADO' : 'ESCUCHANDO...';
                            marketDataCache.exhaustion.rate = "0.00";
                        }
                    } else {
                        liquidityTracker[adId] = {
                            first: { vol: currentVol, time: now },
                            last: { vol: currentVol, time: now }
                        };
                        marketDataCache.exhaustion = {
                            imminent: false,
                            adId: adId,
                            secondsLeft: 0,
                            rate: 0,
                            status: 'SINCRONIZANDO...'
                        };
                    }
                    
                    Object.keys(liquidityTracker).forEach(id => {
                        if (id !== adId) delete liquidityTracker[id];
                    });
                } else {
                    marketDataCache.exhaustion.status = 'SIN COMPETENCIA';
                }

                console.log(`[DASHBOARD] Muro Compra: ${makerBuyPrice} | Muro Venta: ${makerSellPrice} | Predicción: ${marketDataCache.prediction.direction}`);
            }
        }

        // --- 2. SCAN PARA TELEGRAM (Estrictamente BDV) ---
        let telMakerSellAdv, telMakerBuyAdv;
        if (botConfig.mode === 'SOLO_BDV') {
            // Ya calculamos los muros arriba, usamos esos mismos anuncios
            telMakerSellAdv = makerSellAdv;
            telMakerBuyAdv = makerBuyAdv;
        } else {
            const telBuyAds = await fetchBinanceP2P('BUY', FIAT, ASSET, ['BancoDeVenezuela']);
            const telSellAds = await fetchBinanceP2P('SELL', FIAT, ASSET, ['BancoDeVenezuela']);
            telMakerSellAdv = telBuyAds.length > 0 ? telBuyAds[0].adv : null;
            telMakerBuyAdv = telSellAds.length > 0 ? telSellAds[0].adv : null;
        }

        if (telMakerSellAdv && telMakerBuyAdv) {
            const telMyBuyPrice = parseFloat(telMakerBuyAdv.price) + 0.01;
            const telMySellPrice = parseFloat(telMakerSellAdv.price) - 0.01;
            const telSpreadBruto = telMySellPrice - telMyBuyPrice;
            const telSpreadPct = (telSpreadBruto / telMyBuyPrice) * 100;
            const telProfit60k = (60000 / telMyBuyPrice) * telSpreadBruto;

            // Calcular Brecha (Gap) con el BCV para la alerta
            let bcvGap = '---';
            const bcvRateNum = parseFloat(marketDataCache.bcv.rate.replace(',', '.'));
            if (!isNaN(bcvRateNum) && bcvRateNum > 0) {
                bcvGap = (((telMySellPrice / bcvRateNum) - 1) * 100).toFixed(2);
            }
            
            // Lógica de Disparo de Alerta Telegram (Solo BDV)
            if (telProfit60k >= 50 && telSpreadPct > 0.2) {
                sendTelegramAlert(
                    telProfit60k, 
                    telMyBuyPrice.toFixed(2), 
                    telMySellPrice.toFixed(2), 
                    telSpreadPct.toFixed(2)
                );
            }
        }

    } catch (e) {
        console.error('Error in updateMarketData:', e.message);
    }
}

async function huntSilverrabit() {
    try {
        const types = ['BUY', 'SELL'];
        for (const type of types) {
            for (let p = 1; p <= 3; p++) { // Escanear 3 páginas
                const response = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
                    fiat: 'VES',
                    page: p,
                    rows: 20,
                    tradeType: type,
                    asset: 'USDT',
                    payTypes: [],
                    transAmount: "",
                    publisherType: null
                }, {
                    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }
                });

                const ads = response.data.data || [];
                const match = ads.find(a => {
                    const nick = (a.advertiser.nickName || "").toLowerCase().trim();
                    return nick.includes('silverrabit');
                });
                
                if (match) {
                    marketDataCache.fallbackAd = {
                        id: match.adv.advNo,
                        price: parseFloat(match.adv.price),
                        type: match.adv.tradeType,
                        min: parseFloat(match.adv.minSingleTransAmount),
                        max: parseFloat(match.adv.maxSingleTransAmount),
                        surplus: parseFloat(match.adv.surplusAmount),
                        status: 'RASTREO ACTIVO ✅'
                    };
                    return;
                }
            }
        }
        marketDataCache.fallbackAd = null;
    } catch (e) {
        console.error('[CAZADOR ERROR]:', e.message);
    }
}

// Escaneo cada 10s
setInterval(huntSilverrabit, 10000);
huntSilverrabit();

// Endpoints de la API
app.get('/api/arbitrage/status', async (req, res) => {
    const myAds = [];
    if (marketDataCache.fallbackAd) {
        myAds.push(marketDataCache.fallbackAd);
    }

    res.json({
        success: true,
        data: {
            ...marketDataCache,
            myAds: myAds
        },
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

// Iniciar ciclos de escaneo
updateMarketData();
setInterval(updateMarketData, 5000); // Cada 5 segundos

scrapeBCV();
setInterval(scrapeBCV, 60000); // Cada 1 minuto para el canal de Telegram

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('=============================================');
    console.log(`🤖 ARBITRAJE BOT (P2P Radar) ONLINE -> Puerto ${PORT}`);
    console.log('=============================================');
});
