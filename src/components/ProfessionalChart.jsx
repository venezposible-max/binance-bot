import React, { useMemo } from 'react';
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const ProfessionalChart = ({ candles, emaData, color }) => {
    if (!candles || candles.length === 0) return null;

    // MEMOIZED: Transform candle data for recharts
    const chartData = useMemo(() => {
        return candles.slice(-50).map((candle, index) => {
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
                wick: [low, high],
                body: isGreen ? [open, close] : [close, open],
                bodyColor: isGreen ? '#2ebd85' : '#f6465d',
            };
        });
    }, [candles, emaData]);

    const { minPrice, maxPrice, padding } = useMemo(() => {
        const prices = chartData.flatMap(d => [d.high, d.low]);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const pad = (max - min) * 0.1;
        return { minPrice: min, maxPrice: max, padding: pad };
    }, [chartData]);

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
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    zIndex: 100
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

    const CustomCandleBody = (props) => {
        const { x, y, width, height, payload } = props;
        if (!payload || height === 0) return null;
        return (
            <rect x={x} y={y} width={width} height={height} fill={payload.bodyColor} opacity={0.9} />
        );
    };

    const CustomWick = (props) => {
        const { x, y, width, height, payload } = props;
        if (!payload) return null;
        const centerX = x + width / 2;
        return (
            <line x1={centerX} y1={y} x2={centerX} y2={y + height} stroke={payload.bodyColor} strokeWidth={1.5} opacity={0.8} />
        );
    };

    return (
        <div style={{ width: '100%', height: '140px', marginTop: '10px', position: 'relative' }}>
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.03)" vertical={false} />
                    <XAxis dataKey="index" hide />
                    <YAxis domain={[minPrice - padding, maxPrice + padding]} hide />
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255, 255, 255, 0.1)' }} />
                    <Bar dataKey="wick" shape={<CustomWick />} isAnimationActive={false} />
                    <Bar dataKey="body" shape={<CustomCandleBody />} barSize={12} isAnimationActive={false} />
                    {emaData && emaData.length > 0 && (
                        <Line type="monotone" dataKey="ema" stroke="#F59E0B" strokeWidth={2} dot={false} strokeDasharray="4 4" isAnimationActive={false} />
                    )}
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
};

export default React.memo(ProfessionalChart);
