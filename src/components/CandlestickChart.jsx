import React, { useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';

const CandlestickChart = ({ candles, emaData, color }) => {
    const chartContainerRef = useRef(null);
    const chartRef = useRef(null);

    useEffect(() => {
        if (!chartContainerRef.current || !candles || candles.length === 0) return;

        // Create chart
        const chart = createChart(chartContainerRef.current, {
            width: chartContainerRef.current.clientWidth,
            height: 150,
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#64748B',
            },
            grid: {
                vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
                horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
            },
            crosshair: {
                mode: 0,
            },
            rightPriceScale: {
                borderColor: 'rgba(255, 255, 255, 0.1)',
            },
            timeScale: {
                borderColor: 'rgba(255, 255, 255, 0.1)',
                timeVisible: true,
                secondsVisible: false,
            },
        });

        chartRef.current = chart;

        // Add candlestick series using v5 API
        const candlestickSeries = chart.addSeries({
            type: 'Candlestick',
            upColor: '#10B981',
            downColor: '#EF4444',
            borderUpColor: '#10B981',
            borderDownColor: '#EF4444',
            wickUpColor: '#10B981',
            wickDownColor: '#EF4444',
        });

        // Transform candle data to lightweight-charts format
        const formattedCandles = candles.slice(-50).map(candle => {
            // Handle both array format [time, open, high, low, close, volume] and object format
            const isArray = Array.isArray(candle);
            return {
                time: isArray ? Math.floor(candle[0] / 1000) : Math.floor(candle.time / 1000),
                open: isArray ? parseFloat(candle[1]) : parseFloat(candle.open),
                high: isArray ? parseFloat(candle[2]) : parseFloat(candle.high),
                low: isArray ? parseFloat(candle[3]) : parseFloat(candle.low),
                close: isArray ? parseFloat(candle[4]) : parseFloat(candle.close),
            };
        });

        candlestickSeries.setData(formattedCandles);

        // Add EMA line if available
        if (emaData && emaData.length > 0) {
            const lineSeries = chart.addSeries({
                type: 'Line',
                color: '#F59E0B',
                lineWidth: 2,
                lineStyle: 2, // Dashed
                priceLineVisible: false,
                lastValueVisible: false,
            });

            const emaFormatted = emaData.slice(-50).map((value, index) => ({
                time: formattedCandles[index]?.time,
                value: value,
            })).filter(item => item.time && item.value);

            lineSeries.setData(emaFormatted);
        }

        // Fit content
        chart.timeScale().fitContent();

        // Handle resize
        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                });
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (chartRef.current) {
                chartRef.current.remove();
                chartRef.current = null;
            }
        };
    }, [candles, emaData]);

    return (
        <div
            ref={chartContainerRef}
            style={{
                width: '100%',
                height: '150px',
                position: 'relative',
                marginTop: '10px'
            }}
        />
    );
};

export default CandlestickChart;
