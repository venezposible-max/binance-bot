import React, { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Crosshair, Zap, Activity, Signal } from 'lucide-react';
import { motion } from 'framer-motion';

const CVDView = ({ onExit }) => {
    const [data, setData] = useState({ cvd: 0, history: [], stats: {} });
    const [lastDelta, setLastDelta] = useState(0);

    useEffect(() => {
        // Polling loop for "Real-time" feel (200ms)
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
                        history: formattedHistory,
                        stats: json.stats
                    });

                    // Updated delta for simple animation
                    if (json.history.length > 0) {
                        setLastDelta(json.history[json.history.length - 1].delta);
                    }
                }
            } catch (e) {
                console.error("CVD Fetch Error", e);
            }
        }, 200);

        return () => clearInterval(interval);
    }, []);

    const isPositive = data.cvd >= 0;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            style={{
                position: 'fixed',
                top: 0, left: 0, right: 0, bottom: 0,
                background: '#050505',
                color: '#00ff00',
                zIndex: 9999,
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                fontFamily: 'monospace'
            }}
        >
            {/* HEADER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333', paddingBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Crosshair size={32} color={isPositive ? '#00ff00' : '#ff0000'} className="sniper-pulse" />
                    <div>
                        <h1 style={{ margin: 0, fontSize: '1.5rem', letterSpacing: '2px' }}>CVD SNIPER /// <span style={{ color: '#fff' }}>BTCUSDT</span></h1>
                        <span style={{ fontSize: '0.8rem', color: '#666' }}>REAL-TIME ORDER FLOW DELTA</span>
                    </div>
                </div>
                <button
                    onClick={onExit}
                    style={{
                        background: 'transparent',
                        border: '1px solid #333',
                        color: '#666',
                        padding: '10px 20px',
                        cursor: 'pointer',
                        fontSize: '0.9rem'
                    }}
                >
                    EXIT OPERATION
                </button>
            </div>

            {/* MAIN STATS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', padding: '20px 0' }}>
                <StatCard label="NET DELTA (CVD)" value={data.cvd.toLocaleString()} color={isPositive ? '#00ff00' : '#ff0000'} big />
                <StatCard label="LAST TICK IMPACT" value={lastDelta.toLocaleString()} color={lastDelta > 0 ? '#00ff00' : '#ff0000'} />
                <StatCard label="MESSAGES / PROCESSED" value={data.stats.messages || 0} icon={<Activity size={16} />} />
                <StatCard label="WHALE TRIGGERS" value={data.stats.triggers || 0} icon={<Zap size={16} color="yellow" />} />
            </div>

            {/* CHART AREA */}
            <div style={{ flex: 1, background: '#0a0a0a', border: '1px solid #222', borderRadius: '4px', position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.history}>
                        <defs>
                            <linearGradient id="colorCvd" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={isPositive ? '#00ff00' : '#ff0000'} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={isPositive ? '#00ff00' : '#ff0000'} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                        <XAxis dataKey="time" hide />
                        <YAxis domain={['auto', 'auto']} stroke="#444" fontSize={10} width={40} />
                        <Tooltip
                            contentStyle={{ background: '#000', border: '1px solid #333' }}
                            itemStyle={{ color: '#fff' }}
                        />
                        <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                        <Area
                            type="monotone"
                            dataKey="cvd"
                            stroke={isPositive ? '#00ff00' : '#ff0000'}
                            fillOpacity={1}
                            fill="url(#colorCvd)"
                            isAnimationActive={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>

                {data.history.length === 0 && (
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#333' }}>
                        WAITING FOR MARKET DATA...
                    </div>
                )}
            </div>

            <style>{`
                .sniper-pulse { animation: pulse 1s infinite alternate; }
                @keyframes pulse { from { opacity: 0.5; } to { opacity: 1; text-shadow: 0 0 20px #00ff00; } }
            `}</style>
        </motion.div>
    );
};

const StatCard = ({ label, value, color = '#fff', big = false, icon }) => (
    <div style={{ background: '#0f0f0f', padding: '15px', borderLeft: `3px solid ${color}` }}>
        <div style={{ fontSize: '0.7rem', color: '#666', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            {icon} {label}
        </div>
        <div style={{ fontSize: big ? '2.5rem' : '1.5rem', color: color, fontWeight: 'bold' }}>
            {value}
        </div>
    </div>
);

export default CVDView;
