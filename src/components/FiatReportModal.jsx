import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, CreditCard, RefreshCcw, CheckCircle, AlertCircle, Building2, Power, Pencil } from 'lucide-react';

const FiatReportModal = ({ isOpen, onClose }) => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [activeBank, setActiveBank] = useState(null);
    const [editingOrder, setEditingOrder] = useState(null); // ID of the order being edited
    
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

    const updateOrderBank = async (orderNo, bankName) => {
        try {
            await axios.post('/api/fiat-update-tag', { orderNo, bankName });
            setOrders(orders.map(o => o.orderNo === orderNo ? { ...o, customBank: bankName || 'Sin Etiquetas' } : o));
            setEditingOrder(null);
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
                        <Building2 color="#3B82F6" /> MONITOR FIAT BANCARIO
                    </h2>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8e9297', cursor: 'pointer' }}>
                        <X size={24} />
                    </button>
                </div>

                <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                    
                    {/* BANK SELECTOR (Toggles) */}
                    <div style={{ background: '#1a1c24', padding: '15px', borderRadius: '12px', marginBottom: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ fontSize: '0.8rem', color: '#94A3B8', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Power size={14} color={activeBank ? '#10B981' : '#64748B'} /> 
                            {activeBank ? `AUTO-ETIQUETA: ACTUALMENTE EN [ ${activeBank} ]` : 'SIN AUTO-ETIQUETA (Selecciona para automatizar tus próximas compras)'}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {['BDV', 'BANCAMIGA', 'TESORO'].map(name => (
                                <button key={name} onClick={() => toggleBank(name)} style={{
                                    flex: 1, padding: '10px', borderRadius: '8px', transition: 'all 0.2s', border: '1px solid', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem',
                                    background: activeBank === name ? 'rgba(59, 130, 246, 0.2)' : '#0a0b10',
                                    borderColor: activeBank === name ? '#3B82F6' : 'rgba(255,255,255,0.1)',
                                    color: activeBank === name ? '#60A5FA' : '#94A3B8'
                                }}>
                                    {name}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Stats by Bank */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginBottom: '20px' }}>
                        {Object.entries(bankStats).map(([name, stats]) => (
                            <div key={name} style={{ background: '#0a0b10', padding: '12px', borderRadius: '10px', borderLeft: `3px solid ${name==='Global'?'#475569':'#3B82F6'}` }}>
                                <div style={{ fontSize: '0.7rem', color: '#64748B' }}>{name}</div>
                                <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#fff' }}>${stats.vol.toFixed(2)}</div>
                                <div style={{ fontSize: '0.6rem', color: '#475569' }}>{stats.count} Trans.</div>
                            </div>
                        ))}
                    </div>

                    {/* Filters Row */}
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ padding: '8px 12px', borderRadius: '8px', background: '#1a1c24', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', outline: 'none' }}>
                            <option value="1">24h</option><option value="7">7d</option><option value="30">30d</option><option value="custom">Rango</option>
                        </select>
                        
                        {filterType === 'custom' && (
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ padding: '8px 10px', borderRadius: '8px', background: '#1a1c24', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '0.85rem', colorScheme: 'dark' }} />
                                <span style={{ color: '#444' }}>-</span>
                                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ padding: '8px 10px', borderRadius: '8px', background: '#1a1c24', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '0.85rem', colorScheme: 'dark' }} />
                            </div>
                        )}

                        <button onClick={loadOrders} style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', color: '#60A5FA', cursor: 'pointer', marginLeft: 'auto' }}>
                            <RefreshCcw size={14} className={loading ? 'spin' : ''} />
                        </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {filteredOrders.map(o => (
                            <div key={o.orderNo} style={{
                                display: 'flex', flexDirection: 'column', gap: '10px',
                                padding: '15px', borderRadius: '12px', background: '#1a1c24', border: '1px solid rgba(255,255,255,0.05)',
                                borderLeft: `5px solid ${o.status === 'Successful' ? '#10B981' : '#EF4444'}`
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div>
                                        <div style={{ fontWeight: 'bold', fontSize: '1rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {o.indicatedAmount} USD
                                            <span style={{ fontSize: '0.65rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10B981', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
                                                {o.customBank || 'Global'}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: '#64748B', marginTop: '4px' }}>{new Date(o.updateTime).toLocaleString()}</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontWeight: 'bold', color: o.status === 'Successful' ? '#fff' : '#EF4444', fontSize: '0.9rem' }}>{o.amount} USDT</div>
                                        {o.status === 'Successful' && (
                                            <div style={{ fontSize: '0.75rem', color: '#EF4444', fontWeight: 'bold', marginTop: '2px' }}>
                                                -{o.totalFee} {o.fiatCurrency} Fee
                                            </div>
                                        )}
                                        <button 
                                            onClick={() => setEditingOrder(editingOrder === o.orderNo ? null : o.orderNo)} 
                                            style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '8px', padding: 0, marginLeft: 'auto' }}
                                        >
                                            <Pencil size={12} /> MODIFICAR BANCO
                                        </button>
                                    </div>

                                </div>

                                {editingOrder === o.orderNo && (
                                    <div style={{ display: 'flex', gap: '6px', paddingTop: '10px', borderTop: '1px dashed rgba(255,255,255,0.05)' }}>
                                        {['BDV', 'BANCAMIGA', 'TESORO'].map(b => (
                                            <button 
                                                key={b} 
                                                onClick={() => updateOrderBank(o.orderNo, b)}
                                                style={{ flex: 1, padding: '6px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: '#0a0b10', color: '#fff', fontSize: '0.7rem', cursor: 'pointer' }}
                                            >
                                                Asignar {b}
                                            </button>
                                        ))}
                                        <button 
                                            onClick={() => updateOrderBank(o.orderNo, null)}
                                            style={{ flex: 1, padding: '6px', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.2)', background: 'none', color: '#EF4444', fontSize: '0.7rem', cursor: 'pointer' }}
                                        >
                                            Borrar Tag
                                        </button>
                                    </div>
                                )}
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
