import { useState, useEffect, useRef, useCallback } from 'react';
import { TOP_PAIRS as INITIAL_PAIRS, fetchTopPairs, fetchCandles, fetchTickerPrices } from '../api/binance';
import { analyzePair, analyzeFlow, analyzeVolcano, calculateForecast } from '../utils/analysis';

export function useMarketData(activeStrategy, timeframe, tradingMode, walletConfig, cloudStatus) {
    const [pairs, setPairs] = useState(INITIAL_PAIRS);
    const [marketData, setMarketData] = useState({});
    const [loading, setLoading] = useState(true);
    const isFetchingBus = useRef(false);

    // Keep a Ref for the status to avoid stale closures in the Interval (critical fix ported from App.jsx)
    const cloudStatusRef = useRef({ active: [], history: [], blacklist: [] });

    // Sync Ref whenever prop changes
    useEffect(() => {
        cloudStatusRef.current = cloudStatus;
    }, [cloudStatus]);

    const fetchData = useCallback(async (overrideTimeframe) => {
        if (isFetchingBus.current) return; // PREVENT OVERLAP
        isFetchingBus.current = true;

        const currentTf = overrideTimeframe || timeframe;
        const results = {};

        try {
            // 0. Dynamic Pair Selection (Top Volume + Active Trades)
            let currentPairs = [...pairs];

            // ALWAYS Ensure Active Trades are in the fetch list (Use Ref for safety)
            const cachedActive = cloudStatusRef.current.active || [];
            const activeSymbols = cachedActive.map(t => t.symbol);

            // Merge unique
            currentPairs = [...new Set([...currentPairs, ...activeSymbols])];

            if (loading) { // Only fetch new Top Market list on initial load
                try {
                    const topPairs = await fetchTopPairs();
                    // Update base pairs state
                    setPairs(topPairs);
                    // Update local for this cycle
                    currentPairs = [...new Set([...topPairs, ...activeSymbols])];
                } catch (e) {
                    console.warn("Using fallback pairs", e);
                }
            }

            // 1. Fetch Prices (Real-Time Ticker for speed)
            const pricesMap = await fetchTickerPrices(currentPairs);

            // 2. Fetch Candles (Simultaneously for all pairs)
            // [SYNC FIX] Force 150 candles to match Backend logic for proper Odds calculation
            const candlesMap = await fetchCandles(currentPairs, currentTf, 150);

            // 3. Process each pair
            for (const symbol of currentPairs) {
                const klines = candlesMap[symbol] || [];
                let price = pricesMap[symbol];

                // Fallback Price
                if (!price && klines.length > 0) {
                    price = klines[klines.length - 1].close;
                }

                // Run Analysis only if we have enough data
                let analysis = {};
                if (klines.length >= 20) {
                    try {
                        analysis = {
                            ...analyzePair(klines),
                            ...analyzeFlow(null, klines), // Flow indicators (Depth null for now)
                            ...analyzeVolcano(null, klines), // VOLCANO Signal
                            forecast: calculateForecast(klines)
                        };

                        // Capture Raw Technical Signal (The "Dip")
                        const rawSignal = analysis.prediction?.signal || 'NEUTRAL';
                        analysis.indicators.isDip = rawSignal.includes('BUY'); // True if Dip Detected

                        // 💀 CHECK BLACKLIST (Pain Memory)
                        const isBlacklisted = (cloudStatusRef.current.blacklist || []).includes(symbol);
                        analysis.indicators.isBlacklisted = isBlacklisted;

                        // 🛡️ FRONTEND HYBRID FILTER: Match Backend Logic
                        const useHybrid = walletConfig?.strategyConfig?.HYBRID_VORTEX?.useHybrid !== false; // Default ON
                        const odds = parseFloat(analysis.indicators?.hybrid?.odds || 50);

                        if (activeStrategy.includes('VORTEX') && useHybrid && odds < 67) {
                            // Suppress Signal if Odds are too low
                            if (analysis.prediction?.signal.includes('BUY')) {
                                analysis.prediction.signal = 'NEUTRAL';
                                analysis.prediction.label = `🛡️ PROTEGIDO (${odds.toFixed(0)}%)`;
                                analysis.prediction.color = '#64748B'; // Gray out
                            }
                        }

                        // 💀 PAIN MEMORY SUPPRESSION
                        if (isBlacklisted && analysis.prediction?.signal.includes('BUY')) {
                            analysis.prediction.signal = 'NEUTRAL';
                            analysis.prediction.label = `🚫 BLOQUEADO`;
                            analysis.prediction.color = '#EF4444';
                        }
                    } catch (err) {
                        console.warn(`Analysis failed for ${symbol}:`, err);
                    }
                }

                // ALWAYS push to results
                results[symbol] = {
                    symbol,
                    price: price || 0,
                    ...analysis
                };
            }

            setMarketData(results);
            setLoading(false);

        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            isFetchingBus.current = false;
        }
    }, [pairs, timeframe, loading, walletConfig, activeStrategy]); // cloudStatus removed from deps, using Ref

    // Interval Effect
    useEffect(() => {
        fetchData(); // Initial Call
        const interval = setInterval(() => fetchData(), 4000); // 4s Loop
        return () => clearInterval(interval);
    }, [fetchData]);

    // Force flush when mode changes (optional helper exposed)
    const flushData = () => {
        setMarketData({});
        setLoading(true);
    };

    return { marketData, loading, pairs, flushData };
}
