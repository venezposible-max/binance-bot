import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, CreditCard, Filter, AlertCircle, CheckCircle, RefreshCcw } from 'lucide-react';

const FiatReportModal = ({ isOpen, onClose }) => {

    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [dataSource, setDataSource] = useState('api'); // 'api' | 'csv'
    
    // --- Filters ---
    const [filterType, setFilterType] = useState('30'); // '1', '7', '30', '90', 'custom'
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);


    const loadOrders = async () => {
        setLoading(true);
        try {
            const endpoint = dataSource === 'csv' ? '/api/fiat-store' : '/api/fiat-orders';
            const res = await axios.get(endpoint);
            if (res.data && res.data.data) {
                setOrders(res.data.data);
            }
        } catch (e) {
            console.error(e);
        }
        setLoading(false);
    };

    // --- CSV PARSER ---
    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const text = event.target.result;
                const lines = text.split('\n');
                if (lines.length < 2) return alert("Archivo vacío o no válido");

                const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
                const methodIdx = headers.findIndex(h => h.includes('method') || h.includes('método') || h.includes('pago'));
                const amountIdx = headers.findIndex(h => h.includes('amount') || h.includes('monto') || h.includes('cantidad'));
                const feeIdx = headers.findIndex(h => h.includes('fee') || h.includes('comisión') || h.includes('tarifa'));
                const statusIdx = headers.findIndex(h => h.includes('status') || h.includes('estado'));
                const dateIdx = headers.findIndex(h => h.includes('date') || h.includes('fecha') || h.includes('time') || h.includes('tiempo'));

                const newRecords = [];
                for (let i = 1; i < lines.length; i++) {
                    if (!lines[i].trim()) continue;
                    // regex to split by comma ignoring commas inside quotes
                    const row = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
                    
                    const method = methodIdx >= 0 ? row[methodIdx].replace(/"/g, '').trim() : 'Tarjeta Desconocida';
                    
                    // Parse Amount safely (ignoring currency symbols)
                    const rawAmount = amountIdx >= 0 ? row[amountIdx].replace(/[^\d.-]/g, '') : '0';
                    const rawFee = feeIdx >= 0 ? row[feeIdx].replace(/[^\d.-]/g, '') : '0';
                    
                    const amount = parseFloat(rawAmount || 0);
                    const fee = parseFloat(rawFee || 0);
                    
                    const statusStr = statusIdx >= 0 ? row[statusIdx].toLowerCase() : '';
                    const status = (statusStr.includes('fail') || statusStr.includes('fall')) ? 'Failed' : 'Successful';
                    
                    const dateStr = dateIdx >= 0 ? row[dateIdx].replace(/"/g, '') : new Date().toISOString();
                    const timestamp = new Date(dateStr).getTime() || Date.now();
                    
                    const id = btoa(dateStr + amount + method).substring(0, 20); // Virtual ID
                    
                    newRecords.push({
                        id,
                        orderNo: 'CSV-' + id,
                        fiatCurrency: 'USD',
                        indicatedAmount: amount + fee,
                        amount: amount,
                        totalFee: fee,
                        method: method,
                        status: status,
                        updateTime: timestamp
                    });
                }

                // Subir al servidor (Memoria Persistente)
                setLoading(true);
                const res = await axios.post('/api/fiat-store', { newRecords });
                if (res.data.success) {
                    setOrders(res.data.data);
                    setDataSource('csv');
                    alert(`¡Éxito! Base de datos actualizada interno del bot.\\nNuevas cargadas: ${res.data.inserted}`);
                }
            } catch (err) {
                console.error(err);
                alert('Error leyendo CSV. Asegúrate de descargar el archivo correcto de Binance.');
            }
            setLoading(false);
        };
        reader.readAsText(file);
    };



    useEffect(() => {
        if (isOpen) {
            loadOrders();
        }
    }, [isOpen, dataSource]);

    if (!isOpen) return null;

    // Filter logic
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

    // Calc totals
    const successful = filteredOrders.filter(o => o.status === 'Successful');
    const failed = filteredOrders.filter(o => o.status === 'Failed' || o.status === 'FailedToPay');

    const totalUsd = successful.reduce((acc, o) => acc + parseFloat(o.amount || 0), 0);
    const totalFee = successful.reduce((acc, o) => acc + parseFloat(o.totalFee || 0), 0);
    const totalIndicated = successful.reduce((acc, o) => acc + parseFloat(o.indicatedAmount || 0), 0);

    // Group by Cards for CSV View
    const cardsGroups = {};
    if (dataSource === 'csv') {
        successful.forEach(o => {
            const method = o.method || 'Unknown';
            if (!cardsGroups[method]) cardsGroups[method] = { vol: 0, fee: 0, count: 0 };
            cardsGroups[method].vol += parseFloat(o.indicatedAmount || 0);
            cardsGroups[method].fee += parseFloat(o.totalFee || 0);
            cardsGroups[method].count += 1;
        });
    }

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
                    background: 'linear-gradient(90deg, rgba(16, 185, 129, 0.1), transparent)'
                }}>
                    <h2 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <CreditCard color="#10B981" /> REPORTE TARJETAS (FIAT)
                    </h2>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8e9297', cursor: 'pointer' }}>
                        <X size={24} />
                    </button>
                </div>

                {/* BODY */}
                <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                    
                    {/* Tab Navigation */}
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                        <button 
                            onClick={() => setDataSource('api')}
                            style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: dataSource === 'api' ? 'rgba(59, 130, 246, 0.2)' : '#1a1c24', color: dataSource === 'api' ? '#60A5FA' : '#94A3B8', cursor: 'pointer', fontWeight: 'bold' }}
                        >🌐 1. Binance Vivo (Global)</button>
                        <button 
                            onClick={() => setDataSource('csv')}
                            style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: dataSource === 'csv' ? 'rgba(16, 185, 129, 0.2)' : '#1a1c24', color: dataSource === 'csv' ? '#10B981' : '#94A3B8', cursor: 'pointer', fontWeight: 'bold' }}
                        >📁 2. Base de Datos (Detallado)</button>
                    </div>

                    <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <select 
                            value={filterType} 
                            onChange={e => setFilterType(e.target.value)}
                            style={{ 
                                padding: '10px 15px', borderRadius: '8px', background: '#1a1c24', 
                                border: '1px solid rgba(255,255,255,0.1)', color: '#fff', outline: 'none'
                            }}
                        >
                            <option value="1">Últimas 24 Horas</option>
                            <option value="7">Últimos 7 Días</option>
                            <option value="30">Últimos 30 Días</option>
                            <option value="90">Últimos 3 Meses</option>
                            <option value="custom">Rango Personalizado</option>
                        </select>
                        
                        {filterType === 'custom' && (
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <input 
                                    type="date" 
                                    value={startDate} 
                                    onChange={e => setStartDate(e.target.value)}
                                    style={{ padding: '9px 12px', borderRadius: '8px', background: '#1a1c24', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', outline: 'none', colorScheme: 'dark' }}
                                />
                                <span style={{ color: '#64748B' }}>hasta</span>
                                <input 
                                    type="date" 
                                    value={endDate} 
                                    onChange={e => setEndDate(e.target.value)}
                                    style={{ padding: '9px 12px', borderRadius: '8px', background: '#1a1c24', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', outline: 'none', colorScheme: 'dark' }}
                                />
                            </div>
                        )}

                        <button onClick={loadOrders} style={{ 
                            padding: '10px 15px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', 
                            border: '1px solid rgba(59, 130, 246, 0.3)', color: '#60A5FA', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '8px', marginRight: '10px'
                        }}>
                            <RefreshCcw size={14} className={loading ? 'spin' : ''} /> ACTUALIZAR
                        </button>
                        
                        <label style={{
                            padding: '10px 15px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.1)', 
                            border: '1px solid rgba(245, 158, 11, 0.3)', color: '#F59E0B', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold'
                        }}>
                            ⬆️ SUBIR EXCEL
                            <input type="file" accept=".csv" onChange={handleFileUpload} style={{ display: 'none' }} />
                        </label>
                    </div>

                    <div style={{ display: 'flex', gap: '15px', marginBottom: '25px', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: '150px', background: 'rgba(16, 185, 129, 0.05)', padding: '20px', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                            <div style={{ color: '#94A3B8', fontSize: '0.8rem', marginBottom: '5px' }}>TOTAL COMPRADO</div>
                            <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#10B981' }}>${totalIndicated.toFixed(2)}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: '150px', background: '#1a1c24', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ color: '#94A3B8', fontSize: '0.8rem', marginBottom: '5px' }}>USDT RECIBIDO NETO</div>
                            <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#fff' }}>${totalUsd.toFixed(2)}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: '150px', background: 'rgba(239, 68, 68, 0.05)', padding: '20px', borderRadius: '12px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                            <div style={{ color: '#94A3B8', fontSize: '0.8rem', marginBottom: '5px' }}>COMISIONES TARJETAS</div>
                            <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#EF4444' }}>${totalFee.toFixed(2)}</div>
                        </div>
                    </div>

                    {dataSource === 'csv' && Object.keys(cardsGroups).length > 0 && (
                        <div style={{ marginBottom: '25px', background: '#1a1c24', padding: '15px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <h4 style={{ margin: '0 0 10px 0', color: '#10B981', fontSize: '0.9rem' }}>Detalle Discriminado por Tarjeta</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                                {Object.entries(cardsGroups).map(([method, stats]) => (
                                    <div key={method} style={{ background: '#0a0b10', padding: '10px', borderRadius: '8px', borderLeft: '3px solid #10B981' }}>
                                        <div style={{ fontSize: '0.8rem', color: '#fff', fontWeight: 'bold' }}>{method.slice(0, 20)}</div>
                                        <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginTop: '4px' }}>Volumen: <span style={{ color: '#10B981'}}>${stats.vol.toFixed(2)}</span> ({stats.count})</div>
                                        <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Comisiones: <span style={{ color: '#EF4444'}}>${stats.fee.toFixed(2)}</span></div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <h3 style={{ margin: '0 0 15px 0', fontSize: '1rem', color: '#94A3B8' }}>
                        Detalle de Transacciones ({filteredOrders.length})
                    </h3>
                    
                    {loading && <div style={{ textAlign: 'center', padding: '20px' }}>Cargando...</div>}
                    {!loading && filteredOrders.length === 0 && <div style={{ textAlign: 'center', padding: '20px', color: '#64748B' }}>No hay datos para este rango.</div>}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {filteredOrders.map(o => (
                            <div key={o.orderNo} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '15px', borderRadius: '10px',
                                background: '#1a1c24', border: '1px solid rgba(255,255,255,0.05)',
                                borderLeft: `4px solid ${o.status === 'Successful' ? '#10B981' : '#EF4444'}`
                            }}>
                                <div>
                                    <div style={{ fontWeight: 'bold', fontSize: '1rem', color: o.status === 'Successful' ? '#fff' : '#64748B', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {o.status === 'Successful' ? <CheckCircle size={16} color="#10B981"/> : <AlertCircle size={16} color="#EF4444"/>}
                                        {o.indicatedAmount} USD
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '4px' }}>
                                        {new Date(o.updateTime).toLocaleString()} • {o.method}
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontWeight: 'bold', color: o.status === 'Successful' ? '#10B981' : '#EF4444' }}>
                                        {o.status === 'Successful' ? `+${o.amount} ${o.fiatCurrency}` : 'FALLIDA'}
                                    </div>
                                    {o.status === 'Successful' && (
                                        <div style={{ fontSize: '0.7rem', color: '#EF4444', marginTop: '2px' }}>
                                            - {o.totalFee} Fee
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

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
