import React from 'react';
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const ProfessionalChart = ({ candles, emaData, color }) => {
    if (!candles || candles.length === 0) return null;

    // Transform candle data for recharts
    const chartData = candles.slice(-50).map((candle, index) => {
        const isArray = Array.isArray(candle);
        const close = isArray ? parseFloat(candle[4]) : parseFloat(candle.close);
        const open = isArray ? parseFloat(candle[1]) : parseFloat(candle.open);
        const high = isArray ? parseFloat(candle[2]) : parseFloat(candle.high);
        const low = isArray ? parseFloat(candle[3]) : parseFloat(candle.low);

        const isGreen = close >= open;

        return {
            index,
            close,
            open,
            high,
            low,
            ema: emaData && emaData[index] ? emaData[index] : null,
            // Wicks (thin lines from low to high)
            wick: [low, high],
            // Bodies (thicker bars from open to close)
            body: isGreen ? [open, close] : [close, open],
            bodyColor: isGreen ? '#2ebd85' : '#f6465d', // Binance colors
        };
    });

    // Calculate price range (excluding EMA for better scaling)
    const prices = chartData.flatMap(d => [d.high, d.low]);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const padding = (maxPrice - minPrice) * 0.1; // 10% padding

    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            const isGreen = data.close >= data.open;
            return (
                <div style={{
                    background: 'rgba(0, 0, 0, 0.95)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    padding: '10px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                }}>
                    <p style={{ color: '#2ebd85', margin: '3px 0', fontWeight: 'bold' }}>O: ${data.open?.toFixed(2)}</p>
                    <p style={{ color: '#10B981', margin: '3px 0', fontWeight: 'bold' }}>H: ${data.high?.toFixed(2)}</p>
                    <p style={{ color: '#EF4444', margin: '3px 0', fontWeight: 'bold' }}>L: ${data.low?.toFixed(2)}</p>
                    <p style={{ color: isGreen ? '#2ebd85' : '#f6465d', margin: '3px 0', fontWeight: 'bold' }}>C: ${data.close?.toFixed(2)}</p>
                    {data.ema && <p style={{ color: '#F59E0B', margin: '3px 0', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '3px' }}>EMA: ${data.ema.toFixed(2)}</p>}
                </div>
            );
        }
        return null;
    };

    // Custom shape for candlestick bodies with individual colors
    const CustomCandleBody = (props) => {
        const { x, y, width, height, payload } = props;
        if (!payload || height === 0) return null;

        return (
            <rect
                x={x}
                y={y}
                width={width}
                height={height}
                fill={payload.bodyColor}
                opacity={0.9}
            />
        );
    };

    // Custom shape for wicks with individual colors
    const CustomWick = (props) => {
        const { x, y, width, height, payload } = props;
        if (!payload) return null;

        const centerX = x + width / 2;

        return (
            <line
                x1={centerX}
                y1={y}
                x2={centerX}
                y2={y + height}
                stroke={payload.bodyColor}
                strokeWidth={1.5}
                opacity={0.8}
            />
        );
    };

    return (
        <div style={{ width: '100%', height: '150px', marginTop: '10px' }}>
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                    {/* Subtle grid lines */}
                    <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(255, 255, 255, 0.03)"
                        vertical={false}
                    />

                    <XAxis
                        dataKey="index"
                        hide
                    />
                    <YAxis
                        domain={[minPrice - padding, maxPrice + padding]}
                        hide
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255, 255, 255, 0.1)' }} />

                    {/* Candlestick wicks (high-low range) */}
                    <Bar
                        dataKey="wick"
                        shape={<CustomWick />}
                        isAnimationActive={false}
                    />

                    {/* Candlestick bodies (open-close range) */}
                    <Bar
                        dataKey="body"
                        shape={<CustomCandleBody />}
                        barSize={12}
                        isAnimationActive={false}
                    />

                    {/* EMA Line */}
                    {emaData && emaData.length > 0 && (
                        <Line
                            type="monotone"
                            dataKey="ema"
                            stroke="#F59E0B"
                            strokeWidth={2}
                            dot={false}
                            strokeDasharray="4 4"
                            isAnimationActive={false}
                        />
                    )}
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
};

export default ProfessionalChart;
