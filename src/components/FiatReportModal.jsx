import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, CreditCard, Filter, AlertCircle, CheckCircle, RefreshCcw, Settings } from 'lucide-react';

const FiatReportModal = ({ isOpen, onClose }) => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    
    // Card Mapping (Persisted in LocalStorage)
    const [cardMaps, setCardMaps] = useState(() => {
        const saved = localStorage.getItem('sentinel_card_fees');
        return saved ? JSON.parse(saved) : [
            { id: 1, name: 'Zinli', feePerc: 3.37 },
            { id: 2, name: 'Bancamiga', feePerc: 2.00 }
        ];
    });

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
            if (res.data && res.data.data) {
                setOrders(res.data.data);
            }
        } catch (e) {
            console.error(e);
        }
        setLoading(false);
    };

    useEffect(() => {
        if (isOpen) loadOrders();
    }, [isOpen]);

    useEffect(() => {
        localStorage.setItem('sentinel_card_fees', JSON.stringify(cardMaps));
    }, [cardMaps]);

    if (!isOpen) return null;

    const getCardName = (order) => {
        if (order.status !== 'Successful') return 'N/A';
        const fee = parseFloat(order.totalFee || 0);
        const total = parseFloat(order.indicatedAmount || 0);
        if (total === 0) return 'Sin Datos';
        
        const realPerc = (fee / total) * 100;
        
        // Find closest map (within 0.05% tolerance for rounding)
        const matched = cardMaps.find(m => Math.abs(m.feePerc - realPerc) < 0.05);
        return matched ? matched.name : `Card (${realPerc.toFixed(2)}%)`;
    };

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

    const successful = filteredOrders.filter(o => o.status === 'Successful');
    const totalUsd = successful.reduce((acc, o) => acc + parseFloat(o.amount || 0), 0);
    const totalFee = successful.reduce((acc, o) => acc + parseFloat(o.totalFee || 0), 0);
    const totalIndicated = successful.reduce((acc, o) => acc + parseFloat(o.indicatedAmount || 0), 0);

    // Grouping for Stats
    const cardStats = {};
    successful.forEach(o => {
        const name = getCardName(o);
        if (!cardStats[name]) cardStats[name] = { vol: 0, fee: 0, count: 0 };
        cardStats[name].vol += parseFloat(o.indicatedAmount);
        cardStats[name].fee += parseFloat(o.totalFee);
        cardStats[name].count += 1;
    });

    const addCardMap = () => {
        const name = prompt("Nombre de la Tarjeta (ej: Zinli):");
        const perc = prompt("Porcentaje de Comisión (ej: 3.37):");
        if (name && perc) {
            setCardMaps([...cardMaps, { id: Date.now(), name, feePerc: parseFloat(perc) }]);
        }
    };

    const removeCardMap = (id) => {
        setCardMaps(cardMaps.filter(m => m.id !== id));
    };

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
                <div style={{
                    padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'linear-gradient(90deg, rgba(16, 185, 129, 0.1), transparent)'
                }}>
                    <h2 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <CreditCard color="#10B981" /> REPORTE DE COMPRAS
                    </h2>
                    <div style={{ display: 'flex', gap: '15px' }}>
                        <button onClick={() => setShowSettings(!showSettings)} style={{ background: 'none', border: 'none', color: showSettings ? '#10B981' : '#8e9297', cursor: 'pointer' }}>
                            <Settings size={22} />
                        </button>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8e9297', cursor: 'pointer' }}>
                            <X size={24} />
                        </button>
                    </div>
                </div>

                <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                    {showSettings ? (
                        <div style={{ background: '#1a1c24', padding: '20px', borderRadius: '12px', marginBottom: '20px' }}>
                            <h3 style={{ margin: '0 0 15px 0', fontSize: '1rem', color: '#10B981' }}>Configuración de Tarjetas (Detección por %)</h3>
                            <p style={{ fontSize: '0.85rem', color: '#94A3B8', marginBottom: '15px' }}>
                                Ingresa el nombre y el porcentaje que cobra cada tarjeta para que el bot las identifique automáticamente.
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {cardMaps.map(m => (
                                    <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', background: '#0a0b10', padding: '10px 15px', borderRadius: '8px' }}>
                                        <div>
                                            <span style={{ color: '#fff', fontWeight: 'bold' }}>{m.name}</span>
                                            <span style={{ color: '#64748B', marginLeft: '10px' }}>Fee: {m.feePerc}%</span>
                                        </div>
                                        <button onClick={() => removeCardMap(m.id)} style={{ color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}>Eliminar</button>
                                    </div>
                                ))}
                                <button onClick={addCardMap} style={{ marginTop: '5px', padding: '8px', borderRadius: '8px', border: '1px dashed #10B981', background: 'none', color: '#10B981', cursor: 'pointer' }}>
                                    + Agregar Nueva Tarjeta
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
                                <select 
                                    value={filterType} 
                                    onChange={e => setFilterType(e.target.value)}
                                    style={{ padding: '10px 15px', borderRadius: '8px', background: '#1a1c24', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', outline: 'none' }}
                                >
                                    <option value="1">24 Horas</option>
                                    <option value="7">7 Días</option>
                                    <option value="30">30 Días</option>
                                    <option value="90">90 Días</option>
                                    <option value="custom">Custom</option>
                                </select>
                                
                                {filterType === 'custom' && (
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ padding: '9px 12px', borderRadius: '8px', background: '#1a1c24', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', colorScheme: 'dark' }} />
                                        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ padding: '9px 12px', borderRadius: '8px', background: '#1a1c24', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', colorScheme: 'dark' }} />
                                    </div>
                                )}

                                <button onClick={loadOrders} style={{ padding: '10px 15px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', color: '#60A5FA', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <RefreshCcw size={14} className={loading ? 'spin' : ''} />
                                </button>
                            </div>

                            <div style={{ display: 'flex', gap: '15px', marginBottom: '25px', flexWrap: 'wrap' }}>
                                <div style={{ flex: 1, minWidth: '150px', background: 'rgba(16, 185, 129, 0.05)', padding: '20px', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                                    <div style={{ color: '#94A3B8', fontSize: '0.8rem', marginBottom: '5px' }}>COMPRA TOTAL</div>
                                    <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#10B981' }}>${totalIndicated.toFixed(2)}</div>
                                </div>
                                <div style={{ flex: 1, minWidth: '150px', background: 'rgba(239, 68, 68, 0.05)', padding: '20px', borderRadius: '12px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                    <div style={{ color: '#94A3B8', fontSize: '0.8rem', marginBottom: '5px' }}>FEES TOTALES</div>
                                    <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#EF4444' }}>${totalFee.toFixed(2)}</div>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px', marginBottom: '25px' }}>
                                {Object.entries(cardStats).map(([name, stats]) => (
                                    <div key={name} style={{ background: '#1a1c24', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                        <div style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 'bold' }}>{name}</div>
                                        <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginTop: '4px' }}>Vol: ${stats.vol.toFixed(2)} | Fee: ${stats.fee.toFixed(2)}</div>
                                    </div>
                                ))}
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {filteredOrders.map(o => (
                                    <div key={o.orderNo} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '12px 15px', borderRadius: '10px',
                                        background: '#1a1c24', border: '1px solid rgba(255,255,255,0.05)',
                                        borderLeft: `3px solid ${o.status === 'Successful' ? '#10B981' : '#EF4444'}`
                                    }}>
                                        <div>
                                            <div style={{ fontWeight: 'bold', fontSize: '0.95rem', color: '#fff' }}>
                                                {o.indicatedAmount} USD 
                                                <span style={{ marginLeft: '10px', fontSize: '0.75rem', color: '#64748B', fontWeight: 'normal' }}>
                                                    ({getCardName(o)})
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '0.7rem', color: '#64748B' }}>
                                                {new Date(o.updateTime).toLocaleString()}
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontWeight: 'bold', color: o.status === 'Successful' ? '#10B981' : '#EF4444', fontSize: '0.9rem' }}>
                                                {o.status === 'Successful' ? `+${o.amount} USDT` : 'Failed'}
                                            </div>
                                            <div style={{ fontSize: '0.7rem', color: '#EF4444' }}>-{o.totalFee} fee</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
            <style>{`
                .spin { animation: spin 1s linear infinite; }
                @keyframes spin { 100% { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
};

export default FiatReportModal;
