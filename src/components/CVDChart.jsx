import React, { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const CVDChart = () => {
    const [data, setData] = useState({ cvd: 0, history: [] });

    useEffect(() => {
        // Polling loop for CVD data
        const interval = setInterval(async () => {
            try {
                const res = await fetch('/api/cvd');
                if (res.ok) {
                    const json = await res.json();

                    // Transform history for Recharts
                    const formattedHistory = json.history.map(h => ({
                        time: new Date(h.t).toLocaleTimeString(),
                        cvd: h.c,
                        delta: h.d
                    }));

                    setData({
                        price: json.price,
                        cvd: json.cvd,
                        history: formattedHistory
                    });
                }
            } catch (e) {
                console.error("CVD Fetch Error", e);
            }
        }, 500); // 500ms for smooth updates

        return () => clearInterval(interval);
    }, []);

    const isPositive = data.cvd >= 0;
    const lastDelta = data.history.length > 0 ? data.history[data.history.length - 1].delta : 0;
    const currentPrice = data.price || 0;

    return (
        <div style={{ width: '100%', height: '400px', background: '#0a0a0a', borderRadius: '8px', padding: '15px' }}>
            <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '20px' }}>
                <div>
                    <div style={{ color: '#64748B', fontSize: '0.7rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>🔫 CVD SNIPER - BTCUSDT</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 'bold', fontFamily: 'monospace', color: '#fff' }}>
                        ${currentPrice.toLocaleString()}
                    </div>
                </div>

                <div style={{ textAlign: 'center' }}>
                    <div style={{ color: '#64748B', fontSize: '0.7rem', fontWeight: 'bold', textTransform: 'uppercase' }}>LAST DELTA (USDT)</div>
                    <div style={{
                        color: lastDelta >= 0 ? '#10B981' : '#EF4444',
                        fontSize: '1.4rem',
                        fontWeight: 'bold',
                        fontFamily: 'monospace'
                    }}>
                        {lastDelta >= 0 ? '+' : ''}{Math.round(lastDelta).toLocaleString()}
                    </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#64748B', fontSize: '0.7rem', fontWeight: 'bold', textTransform: 'uppercase' }}>CUMULATIVE DELTA (CVD)</div>
                    <div style={{
                        color: isPositive ? '#10B981' : '#EF4444',
                        fontSize: '1.4rem',
                        fontWeight: 'bold',
                        fontFamily: 'monospace'
                    }}>
                        {isPositive ? '+' : ''}{(Math.round(data.cvd) || 0).toLocaleString()}
                    </div>
                </div>
            </div>

            <div style={{ height: '300px', position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.history || []}>
                        <defs>
                            <linearGradient id="colorCvd" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={isPositive ? '#10B981' : '#EF4444'} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={isPositive ? '#10B981' : '#EF4444'} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false} />
                        <XAxis dataKey="time" hide />
                        <YAxis domain={['auto', 'auto']} stroke="#444" fontSize={10} width={60} orientation="left" />
                        <YAxis domain={['auto', 'auto']} stroke="#F59E0B" fontSize={10} width={60} orientation="right" yAxisId="price" hide />
                        <Tooltip
                            contentStyle={{ background: '#000', border: '1px solid #333' }}
                            itemStyle={{ color: '#fff' }}
                            labelStyle={{ color: '#64748B', fontSize: '10px' }}
                        />
                        <ReferenceLine y={0} stroke="#444" strokeWidth={2} />
                        <Area
                            type="monotone"
                            dataKey="cvd"
                            stroke={isPositive ? '#10B981' : '#EF4444'}
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorCvd)"
                            isAnimationActive={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
                {data.history.length === 0 && (
                    <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        color: '#444',
                        fontSize: '0.9rem'
                    }}>
                        ⌛ Waiting for market data...
                    </div>
                )}
            </div>
        </div>
    );
};

export default CVDChart;
