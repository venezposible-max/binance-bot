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

    return (
        <div style={{ width: '100%', height: '400px', background: '#0a0a0a', borderRadius: '8px', padding: '10px' }}>
            <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#666', fontSize: '0.8rem' }}>🔫 CVD SNIPER - BTCUSDT</span>
                <span style={{
                    color: isPositive ? '#10B981' : '#EF4444',
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    fontFamily: 'monospace'
                }}>
                    {isPositive ? '+' : ''}{(data.cvd || 0).toLocaleString()}
                </span>
            </div>
            <ResponsiveContainer width="100%" height="90%">
                <AreaChart data={data.history || []}>
                    <defs>
                        <linearGradient id="colorCvd" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={isPositive ? '#10B981' : '#EF4444'} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={isPositive ? '#10B981' : '#EF4444'} stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                    <XAxis dataKey="time" hide />
                    <YAxis domain={['auto', 'auto']} stroke="#444" fontSize={10} width={60} />
                    <Tooltip
                        contentStyle={{ background: '#000', border: '1px solid #333' }}
                        itemStyle={{ color: '#fff' }}
                    />
                    <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                    <Area
                        type="monotone"
                        dataKey="cvd"
                        stroke={isPositive ? '#10B981' : '#EF4444'}
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
    );
};

export default CVDChart;
