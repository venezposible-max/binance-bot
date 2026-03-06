import React, { useState, useEffect } from 'react';
import { X, Globe, TrendingUp, RefreshCw, ArrowRightLeft, Percent, Wallet, AlertCircle } from 'lucide-react';
import styles from './VESArbitrageModal.module.css';
import { API_BASE } from '../config/api';

const VESArbitrageModal = ({ isOpen, onClose }) => {
    const [rates, setRates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchRates = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/arbitrage/ves`);
            const json = await res.json();
            if (json.success && json.data.rates) {
                setRates(json.data.rates);
            }
        } catch (e) {
            setError("Error conectando con los servidores de Binance.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchRates();
            const interval = setInterval(fetchRates, 30000); // 30 sec refresh
            return () => clearInterval(interval);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    // Calculate Arbitrage
    const filteredRates = rates.filter(r => r.buy > 0 && r.sell > 0);
    const bestBuy = filteredRates.length > 0 ? filteredRates.reduce((prev, curr) => parseFloat(prev.buy) < parseFloat(curr.buy) ? prev : curr) : null;
    const bestSell = filteredRates.length > 0 ? filteredRates.reduce((prev, curr) => parseFloat(prev.sell) > parseFloat(curr.sell) ? prev : curr) : null;
    const spread = (bestBuy && bestSell) ? ((parseFloat(bestSell.sell) - parseFloat(bestBuy.buy)) / parseFloat(bestBuy.buy)) * 100 : 0;

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
                <header className={styles.header}>
                    <div className={styles.titleArea}>
                        <Globe className={styles.globeIcon} size={24} color="#00D9FF" />
                        <h2>MONITOR P2P VENEZUELA <span className={styles.liveBadge}>LIVE</span></h2>
                    </div>
                    <button className={styles.closeBtn} onClick={onClose}><X size={20} /></button>
                </header>

                <div className={styles.body}>
                    {loading && rates.length === 0 ? (
                        <div className={styles.loadingArea}>
                            <RefreshCw className={styles.spin} size={40} color="#00D9FF" />
                            <p>Escaneando Binance P2P...</p>
                        </div>
                    ) : error ? (
                        <div className={styles.errorArea}>
                            <AlertCircle size={40} color="#EF4444" />
                            <p>{error}</p>
                            <button onClick={fetchRates} className={styles.retryBtn}>Reintentar</button>
                        </div>
                    ) : (
                        <>
                            {/* Best Opportunity Banner */}
                            {spread > 0 && (
                                <div className={`${styles.oppBanner} ${spread > 2 ? styles.golden : ''}`}>
                                    <TrendingUp size={24} />
                                    <div className={styles.oppInfo}>
                                        <h3>ARBITRAJE DETECTADO: <span>{spread.toFixed(2)}%</span></h3>
                                        <p>Compra en <strong>{bestBuy.name}</strong> ➔ Vende en <strong>{bestSell.name}</strong></p>
                                    </div>
                                    <div className={styles.oppProfit}>
                                        <span>+${(spread * 10).toFixed(2)}</span>
                                        <small>Por cada $1000</small>
                                    </div>
                                </div>
                            )}

                            {/* Rates Table */}
                            <div className={styles.tableContainer}>
                                <table className={styles.ratesTable}>
                                    <thead>
                                        <tr>
                                            <th>BANCO</th>
                                            <th>COMPRA (Tú das Bs)</th>
                                            <th>VENTA (Tú recibes Bs)</th>
                                            <th>GAP</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rates.map(bank => {
                                            const bankGap = ((bank.sell - bank.buy) / bank.buy) * 100;
                                            return (
                                                <tr key={bank.name}>
                                                    <td className={styles.bankName}>{bank.name}</td>
                                                    <td className={styles.buyPrice}>{parseFloat(bank.buy).toFixed(2)} Bs</td>
                                                    <td className={styles.sellPrice}>{parseFloat(bank.sell).toFixed(2)} Bs</td>
                                                    <td className={styles.gapVal} style={{ color: bankGap > 1 ? '#10B981' : '#64748B' }}>
                                                        {bankGap.toFixed(2)}%
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            <div className={styles.footerNote}>
                                <RefreshCw size={12} className={styles.spin} />
                                <span>Actualizando automáticamente cada 30 segundos usando tu Binance API Key.</span>
                            </div>
                        </>
                    )}
                </div>

                <footer className={styles.footer}>
                    <button className={styles.actionBtn} onClick={fetchRates}>
                        <RefreshCw size={16} /> FORZAR RECARGA
                    </button>
                    <button className={styles.secondaryBtn} onClick={onClose}>
                        CERRAR MONITOR
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default VESArbitrageModal;

