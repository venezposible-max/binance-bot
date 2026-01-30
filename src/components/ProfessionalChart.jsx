import React from 'react';
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const ProfessionalChart = ({ candles, emaData, color }) => {
    if (!candles || candles.length === 0) return null;

    // Transform candle data for recharts
    const chartData = candles.slice(-50).map((candle, index) => {
        const isArray = Array.isArray(candle);
        const close = isArray ? parseFloat(candle[4]) : parseFloat(candle.close);
        const open = isArray ? parseFloat(candle[1]) : parseFloat(candle.open);
        const high = isArray ? parseFloat(candle[2]) : parseFloat(candle.high);
        const low = isArray ? parseFloat(candle[3]) : parseFloat(candle.low);

        return {
            index,
            close,
            open,
            high,
            low,
            candleColor: close >= open ? '#10B981' : '#EF4444',
            ema: emaData && emaData[index] ? emaData[index] : null,
            // For bar chart representation of candles
            range: [low, high],
            body: close >= open ? [open, close] : [close, open],
        };
    });

    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div style={{
                    background: 'rgba(0, 0, 0, 0.9)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    padding: '8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem'
                }}>
                    <p style={{ color: '#10B981', margin: '2px 0' }}>H: ${data.high?.toFixed(2)}</p>
                    <p style={{ color: '#fff', margin: '2px 0' }}>C: ${data.close?.toFixed(2)}</p>
                    <p style={{ color: '#EF4444', margin: '2px 0' }}>L: ${data.low?.toFixed(2)}</p>
                    {data.ema && <p style={{ color: '#F59E0B', margin: '2px 0' }}>EMA: ${data.ema.toFixed(2)}</p>}
                </div>
            );
        }
        return null;
    };

    return (
        <div style={{ width: '100%', height: '150px', marginTop: '10px' }}>
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                    <XAxis
                        dataKey="index"
                        hide
                    />
                    <YAxis
                        domain={['dataMin - 10', 'dataMax + 10']}
                        hide
                    />
                    <Tooltip content={<CustomTooltip />} />

                    {/* Candlestick wicks (high-low range) */}
                    <Bar
                        dataKey="range"
                        fill="transparent"
                        stroke={color}
                        strokeWidth={1}
                        isAnimationActive={false}
                    />

                    {/* Candlestick bodies */}
                    <Bar
                        dataKey="body"
                        fill={color}
                        opacity={0.8}
                        barSize={6}
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
                            strokeDasharray="3 3"
                            isAnimationActive={false}
                        />
                    )}
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
};

export default ProfessionalChart;
