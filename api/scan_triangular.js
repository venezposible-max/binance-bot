
import axios from 'axios';

const BASE_ASSET = 'USDT';
const FEE = 0.001; // 0.1% per trade (0.003 total)
const TOTAL_FEES = 1 - Math.pow(1 - FEE, 3); // ~0.003

async function scanTriangular() {
    console.log(`📐 SCANNING FOR TRIANGULAR ARBITRAGE (Base: ${BASE_ASSET})...`);
    console.log(`💰 Min Profit Needed to cover fees: ${(TOTAL_FEES * 100).toFixed(3)}%`);

    try {
        // 1. Get ALL Tickers
        const res = await axios.get('https://api.binance.com/api/v3/ticker/bookTicker');
        const tickers = {};
        res.data.forEach(t => {
            tickers[t.symbol] = {
                bid: parseFloat(t.bidPrice),
                ask: parseFloat(t.askPrice)
            };
        });

        // 2. Find Triangular Paths
        // Path: USDT -> A -> B -> USDT
        // Example: USDT -> BTC -> ETH -> USDT

        let opportunities = 0;

        // Step 1: Find all pairs trading with USDT (e.g. BTCUSDT, ETHUSDT)
        const directPairs = Object.keys(tickers).filter(s => s.endsWith(BASE_ASSET));

        for (const pairA of directPairs) {
            const assetA = pairA.replace(BASE_ASSET, ''); // e.g. BTC

            // Step 2: Find pairs trading with Asset A (e.g. ETHBTC, BNBBTC)
            // Can be formatted as ETHBTC (ETH/BTC) or BTCETH (BTC/ETH) - usually Quote is the bigger one
            const crossPairs = Object.keys(tickers).filter(s => s.endsWith(assetA) || s.startsWith(assetA));

            for (const pairB of crossPairs) {
                if (pairB === pairA) continue;

                // Identify Asset B
                let assetB = '';
                let directionB = ''; // 'BUY' or 'SELL' relative to Asset A

                if (pairB.endsWith(assetA)) { // e.g. ETHBTC (Buying ETH with BTC)
                    assetB = pairB.replace(assetA, '');
                    directionB = 'BUY';
                } else { // e.g. BTCETH (Selling BTC for ETH) - rare structure but possible
                    assetB = pairB.replace(assetA, ''); // Warning: Logic depends on symbol structure
                    // Actually Binance usually puts the stronger asset last. 
                    // Let's stick to standard pairs like ETHBTC.
                    // If pairB starts with assetA (BTCETH), we are selling A to get B.
                    assetB = pairB.substring(assetA.length);
                    directionB = 'SELL';
                }

                if (!assetB || assetB === BASE_ASSET) continue;

                // Step 3: Check if Asset B trades with USDT (e.g. ETHUSDT)
                const pairC = assetB + BASE_ASSET;
                const pairC_Reverse = BASE_ASSET + assetB;

                let finalPair = '';
                let directionC = '';

                if (tickers[pairC]) {
                    finalPair = pairC;
                    directionC = 'SELL'; // Sell B to get USDT
                } else if (tickers[pairC_Reverse]) {
                    // Very rare for USDT pairs
                    finalPair = pairC_Reverse;
                    directionC = 'BUY';
                } else {
                    continue; // Cycle incomplete
                }

                // --- 🧮 CALCULATE PROFIT ---

                // 1. START with 100 USDT
                let initialDetails = `100 ${BASE_ASSET}`;
                let currentAmt = 100;

                // TRADE 1: Buy Asset A with USDT (e.g. Buy BTC)
                // We buy at ASK price
                const rateA = tickers[pairA].ask;
                if (!rateA) continue;
                currentAmt = currentAmt / rateA; // Buying A

                // TRADE 2: Trade A for B 
                let rateB = 0;
                if (directionB === 'BUY') {
                    // e.g. ETHBTC. We have BTC, want ETH. We BUY ETH using BTC.
                    // We pay ASK price of ETHBTC
                    rateB = tickers[pairB].ask;
                    if (!rateB) continue;
                    currentAmt = currentAmt / rateB; // Buying B
                } else {
                    // e.g. BTCETH (If exists). We have BTC, want ETH. We SELL BTC for ETH.
                    // Sell matched to BID
                    rateB = tickers[pairB].bid;
                    if (!rateB) continue;
                    currentAmt = currentAmt * rateB;
                }

                // TRADE 3: Trade B back to USDT
                let rateC = 0;
                if (directionC === 'SELL') { // e.g. ETHUSDT. Sell ETH for USDT.
                    rateC = tickers[finalPair].bid;
                    if (!rateC) continue;
                    currentAmt = currentAmt * rateC;
                } else {
                    rateC = tickers[finalPair].ask;
                    if (!rateC) continue;
                    currentAmt = currentAmt / rateC;
                }

                // RESULT
                const grossProfit = ((currentAmt - 100) / 100) * 100;
                const netProfit = grossProfit - (TOTAL_FEES * 100);

                if (netProfit > 0) {
                    opportunities++;
                    console.log(`\n🚨 OPPORTUNITY FOUND! [${pairA} -> ${pairB} -> ${finalPair}]`);
                    console.log(`   Net Profit: ${netProfit.toFixed(4)}% (Gross: ${grossProfit.toFixed(4)}%)`);
                    console.log(`   Path: USDT -> ${assetA} -> ${assetB} -> USDT`);
                }
            }
        }

        if (opportunities === 0) {
            console.log('\n😴 NO OPPORTUNITIES FOUND.');
            console.log('   (Markets are efficient right now. No gaps > 0.3%)');
        }

    } catch (e) {
        console.error("Scan Error:", e.message);
    }
}

scanTriangular();
