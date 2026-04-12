import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, CreditCard, RefreshCcw, CheckCircle, AlertCircle, Building2, Power } from 'lucide-react';

const FiatReportModal = ({ isOpen, onClose }) => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [activeBank, setActiveBank] = useState(null);
    
    // Filters
    const [filterType, setFilterType] = useState('30'); 
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

    const loadOrders = async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/fiat-orders');
            if (res.data) {
                setOrders(res.data.data || []);
                setActiveBank(res.data.activeBank || null);
            }
        } catch (e) { console.error(e); }
        setLoading(false);
    };

    const toggleBank = async (bankName) => {
        try {
            const newBank = activeBank === bankName ? null : bankName;
            const res = await axios.post('/api/fiat-active-bank', { bankName: newBank });
            setActiveBank(res.data.activeBank);
        } catch (e) { console.error(e); }
    };

    useEffect(() => {
        if (isOpen) loadOrders();
    }, [isOpen]);

    if (!isOpen) return null;

    const filteredOrders = orders.filter(o => {
        const txDate = new Date(o.updateTime);
        if (filterType === 'custom') {
            const start = new Date(startDate);
            start.setHours(0,0,0,0);
            const end = new Date(endDate);
            end.setHours(23,59,59,999);
            return txDate >= start && txDate <= end;
        } else {
            const cutoffTime = Date.now() - (Number(filterType) * 24 * 60 * 60 * 1000);
            return o.updateTime >= cutoffTime;
        }
    });

    // Stats by Bank
    const successful = filteredOrders.filter(o => o.status === 'Successful');
    const totalUsdPaid = successful.reduce((acc, o) => acc + parseFloat(o.indicatedAmount || 0), 0);
    const totalFees = successful.reduce((acc, o) => acc + parseFloat(o.totalFee || 0), 0);

    const bankStats = {};
    successful.forEach(o => {
        const b = o.customBank || 'Global';
        if (!bankStats[b]) bankStats[b] = { vol: 0, count: 0 };
        bankStats[b].vol += parseFloat(o.indicatedAmount);
        bankStats[b].count += 1;
    });

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1000,
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            padding: '20px', backdropFilter: 'blur(5px)'
        }}>
            <div style={{
                background: '#15171f', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '16px', width: '100%', maxWidth: '800px', maxHeight: '90vh',
                display: 'flex', flexDirection: 'column', overflow: 'hidden'
            }}>
                {/* HEAD */}
                <div style={{
                    padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'linear-gradient(90deg, rgba(59, 130, 246, 0.1), transparent)'
                }}>
                    <h2 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Building2 color="#3B82F6" /> MONITOR DE BANCOS
                    </h2>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8e9297', cursor: 'pointer' }}>
                        <X size={24} />
                    </button>
                </div>

                <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                    
                    {/* BANK SELECTOR (Toggles) */}
                    <div style={{ background: '#1a1c24', padding: '15px', borderRadius: '12px', marginBottom: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ fontSize: '0.85rem', color: '#94A3B8', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Power size={14} color={activeBank ? '#10B981' : '#64748B'} /> 
                            {activeBank ? `ETIQUETADO ACTIVO: ${activeBank}` : 'SIN ETIQUETADO ACTIVO (Selecciona uno antes de comprar)'}
                        </div>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            {['BDV', 'BANCAMIGA', 'TESORO'].map(name => (
                                <button key={name} onClick={() => toggleBank(name)} style={{
                                    flex: 1, padding: '12px', borderRadius: '10px', transition: 'all 0.2s', border: '1px solid', fontWeight: 'bold', cursor: 'pointer',
                                    background: activeBank === name ? 'rgba(16, 185, 129, 0.2)' : '#0a0b10',
                                    borderColor: activeBank === name ? '#10B981' : 'rgba(255,255,255,0.1)',
                                    color: activeBank === name ? '#10B981' : '#94A3B8'
                                }}>
                                    {name}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Stats by Bank */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '25px' }}>
                        {Object.entries(bankStats).map(([name, stats]) => (
                            <div key={name} style={{ background: '#1a1c24', padding: '15px', borderRadius: '12px', borderBottom: `3px solid ${name==='Global'?'#64748B':'#3B82F6'}` }}>
                                <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{name}</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#fff' }}>${stats.vol.toFixed(2)}</div>
                                <div style={{ fontSize: '0.65rem', color: '#64748B' }}>{stats.count} Compras</div>
                            </div>
                        ))}
                    </div>

                    {/* Filters Row */}
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ padding: '8px 12px', borderRadius: '8px', background: '#1a1c24', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', outline: 'none' }}>
                            <option value="1">24h</option><option value="7">7d</option><option value="30">30d</option><option value="custom">Custom</option>
                        </select>
                        <button onClick={loadOrders} style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', color: '#60A5FA', cursor: 'pointer', marginLeft: 'auto' }}>
                            <RefreshCcw size={14} className={loading ? 'spin' : ''} />
                        </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {filteredOrders.map(o => (
                            <div key={o.orderNo} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '12px 15px', borderRadius: '10px', background: '#1a1c24', border: '1px solid rgba(255,255,255,0.05)',
                                borderLeft: `4px solid ${o.status === 'Successful' ? '#10B981' : '#EF4444'}`
                            }}>
                                <div>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.95rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {o.status === 'Successful' ? <CheckCircle size={14} color="#10B981"/> : <AlertCircle size={14} color="#EF4444"/>}
                                        {o.indicatedAmount} USD
                                        <span style={{ fontSize: '0.7rem', background: 'rgba(59, 130, 246, 0.1)', color: '#60A5FA', padding: '2px 8px', borderRadius: '4px', marginLeft: '5px' }}>
                                            {o.customBank || 'Sin Banco'}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '0.7rem', color: '#64748B' }}>{new Date(o.updateTime).toLocaleString()}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontWeight: 'bold', color: o.status === 'Successful' ? '#fff' : '#EF4444', fontSize: '0.9rem' }}>{o.amount} USDT</div>
                                    <div style={{ fontSize: '0.7rem', color: '#EF4444' }}>-{o.totalFee} fee</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <style>{` .spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } } `}</style>
        </div>
    );
};

export default FiatReportModal;
