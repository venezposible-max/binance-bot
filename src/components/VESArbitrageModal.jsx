import React, { useState, useEffect } from 'react';
import { X, Globe, DollarSign, ArrowRight, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import styles from './VESArbitrageModal.module.css';
import { API_BASE } from '../config/api';

const VESArbitrageModal = ({ isOpen, onClose }) => {
    const [amount, setAmount] = useState(100);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [manualBankRate, setManualBankRate] = useState(430);
    const [manualP2PRate, setManualP2PRate] = useState(568);
    const [isEditingRate, setIsEditingRate] = useState(false);
    const [isEditingP2P, setIsEditingP2P] = useState(false);
    const [strategy, setStrategy] = useState('saldoar'); // 'saldoar' or 'zelle'


    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/arbitrage/ves`);
            const json = await res.ok ? await res.json() : null;
            if (json && json.success) {
                setData(json.data);
                setManualBankRate(json.data.bank.rate);
                setManualP2PRate(json.data.p2p.rate);
            }
        } catch (e) {
            console.error("Failed to fetch arbitrage data", e);
        } finally {
            setLoading(false);
        }
    };

    const updateRates = async () => {
        try {
            await fetch(`${API_BASE}/api/arbitrage/ves`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bankRate: manualBankRate,
                    p2pRate: manualP2PRate
                })
            });
            setIsEditingRate(false);
            setIsEditingP2P(false);
            fetchData();
        } catch (e) {
            console.error("Failed to update rates", e);
        }
    };

    useEffect(() => {
        if (isOpen) fetchData();
    }, [isOpen]);

    if (!isOpen) return null;

    // --- CALCULATIONS ---
    const bdvFee = amount * 0.081; // Exact: $1.62 per $20 (8.1%)
    const totalSpent = amount + bdvFee; // Cost in bank ($10.81 - $10.82)

    // Step 1: PayPal Friction
    // Observed: In 'zelle' path, $20 results in $19.10 (Fee = $0.90 = 4.5%)
    const paypalFee = strategy === 'zelle'
        ? (amount * 0.045)
        : (amount > 0 ? (amount * 0.054) + 0.30 : 0);
    const netoPaypal = Math.max(0, amount - paypalFee);

    let usdtReceived = 0;
    let strategyLabel = "";
    let step2Label = "";
    let saldoarFees = { commission: 0, spread: 0 };

    if (strategy === 'saldoar') {
        // REFINED FORMULA to match $10 -> 8.60, $30 -> 26.49, $50 -> 44.44
        // Formula: (Amount * 0.89625) - 0.39
        usdtReceived = Math.max(0, (amount * 0.89625) - 0.39);

        // Breakdown for UI matched to the $30 report
        const totalGap = netoPaypal - usdtReceived;
        if (amount <= 15) saldoarFees.commission = 0.47;
        else if (amount <= 35) saldoarFees.commission = 0.68; // User report for $30
        else saldoarFees.commission = 0.91; // User report for $50

        saldoarFees.spread = Math.max(0, totalGap - saldoarFees.commission);

        strategyLabel = "SALDOAR";
        step2Label = "SALDOAR ➔ BINANCE";
    } else {
        // Zelle path (2% fixed)
        usdtReceived = netoPaypal * 0.98;
        strategyLabel = "ZELLE (PEDRO)";
        step2Label = "ZELLE ➔ TETHER (2%)";
    }

    const bolivaresTotal = usdtReceived * manualP2PRate;
    const finalUSD = bolivaresTotal / manualBankRate;

    const profitUSD = finalUSD - totalSpent;
    const profitPercent = totalSpent > 0 ? (profitUSD / totalSpent) * 100 : 0;


    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
                <header className={styles.header}>
                    <div className={styles.titleArea}>
                        <Globe className={styles.globeIcon} size={24} />
                        <h2>MONITOR ARBITRAJE VENEZUELA v2 🇻🇪</h2>
                    </div>
                    <button className={styles.closeBtn} onClick={onClose}><X size={20} /></button>
                </header>

                <div className={styles.body}>
                    <div className={styles.strategyToggle}>
                        <button
                            className={strategy === 'saldoar' ? styles.activeTab : ''}
                            onClick={() => setStrategy('saldoar')}
                        >
                            VÍA SALDOAR (Rápido)
                        </button>
                        <button
                            className={strategy === 'zelle' ? styles.activeTab : ''}
                            onClick={() => setStrategy('zelle')}
                        >
                            VÍA ZELLE (3 Días)
                        </button>
                    </div>

                    <div className={styles.inputSection}>
                        <div className={styles.inputGroup}>
                            <label>Monto Inicial (USD en Banco)</label>
                            <div className={styles.inputWrapper}>
                                <DollarSign size={16} />
                                <input
                                    type="number"
                                    value={amount}
                                    onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                                />
                            </div>
                        </div>

                        <div className={styles.inputGroup}>
                            <label>Tasa Banco de Venezuela (Manual)</label>
                            <div className={styles.inputWrapper}>
                                <RefreshCw size={16} />
                                <input
                                    type="number"
                                    value={manualBankRate}
                                    disabled={!isEditingRate}
                                    onChange={(e) => setManualBankRate(parseFloat(e.target.value) || 0)}
                                />
                                {isEditingRate ? (
                                    <button className={styles.saveBtn} onClick={updateRates}>OK</button>
                                ) : (
                                    <button className={styles.editBtn} onClick={() => setIsEditingRate(true)}>EDITAR</button>
                                )}
                            </div>
                        </div>

                        <div className={styles.inputGroup}>
                            <label>Tasa Binance P2P (VES)</label>
                            <div className={styles.inputWrapper}>
                                <ArrowRight size={16} />
                                <input
                                    type="number"
                                    value={manualP2PRate}
                                    disabled={!isEditingP2P}
                                    onChange={(e) => setManualP2PRate(parseFloat(e.target.value) || 0)}
                                />
                                {isEditingP2P ? (
                                    <button className={styles.saveBtn} onClick={updateRates}>OK</button>
                                ) : (
                                    <button className={styles.editBtn} onClick={() => setIsEditingP2P(true)}>EDITAR</button>
                                )}
                            </div>
                        </div>
                    </div>

                    {loading ? (
                        <div className={styles.loading}>
                            <RefreshCw className={styles.spin} size={32} />
                            <p>Consultando tasas de cambio...</p>
                        </div>
                    ) : (
                        <div className={styles.resultsArea}>
                            <div className={styles.stepCard}>
                                <div className={styles.stepHeader}>
                                    <span className={styles.stepBadge}>1</span>
                                    <span>BANCO ➔ PAYPAL ➔ {strategyLabel}</span>
                                </div>
                                <div className={styles.stepInfo}>
                                    <p>Monto a transferir: <strong>${amount.toFixed(2)}</strong></p>
                                    <div className={styles.feesList}>
                                        <p className={styles.fee}>Comisión BDV (8.1%): +${bdvFee.toFixed(2)}</p>
                                        <p className={styles.fee}>Fee PayPal (Gasto): -${paypalFee.toFixed(2)}</p>
                                        <p style={{ fontSize: '0.8rem', opacity: 0.8 }}>Gasto total Real: <strong>${totalSpent.toFixed(2)}</strong></p>
                                    </div>
                                    <p>Neto en {strategyLabel}: <strong>${netoPaypal.toFixed(2)}</strong></p>
                                </div>
                            </div>

                            <ArrowRight className={styles.arrow} size={20} />

                            <div className={styles.stepCard}>
                                <div className={styles.stepHeader}>
                                    <span className={styles.stepBadge}>2</span>
                                    <span>{step2Label}</span>
                                </div>
                                <div className={styles.stepInfo}>
                                    <p>Ratio Efectivo: <strong>{(usdtReceived / netoPaypal || 0).toFixed(3)} USDT/USD</strong></p>
                                    <div className={styles.feesList}>
                                        <p className={styles.fee}>Comisión Saldoar (Fija): -${saldoarFees.commission.toFixed(2)} USDT</p>
                                        <p className={styles.fee}>Spread / Red: -${saldoarFees.spread.toFixed(2)} USDT</p>
                                    </div>
                                    <p>Binance Recibe: <strong className={styles.highlight}>{usdtReceived.toFixed(2)} USDT</strong></p>
                                </div>
                            </div>

                            <ArrowRight className={styles.arrow} size={24} />

                            <div className={styles.stepCard}>
                                <div className={styles.stepHeader}>
                                    <span className={styles.stepBadge}>3</span>
                                    <span>P2P ➔ BANCO</span>
                                </div>
                                <div className={styles.stepInfo}>
                                    <p>Tasa P2P: <strong>{manualP2PRate.toFixed(2)} VES</strong></p>
                                    <p>Bolívares: <strong>{bolivaresTotal.toLocaleString()} VES</strong></p>
                                </div>
                            </div>

                            <div className={styles.summaryCard}>
                                <div className={styles.summaryHeader}>
                                    {profitPercent > 0 ? (
                                        <CheckCircle size={32} color="#10B981" />
                                    ) : (
                                        <AlertTriangle size={32} color="#EF4444" />
                                    )}
                                    <div className={styles.summaryTitle}>
                                        <h3>RESULTADO DEL CICLO</h3>
                                        <p>Comprando USD al banco a {manualBankRate} VES</p>
                                    </div>
                                </div>
                                <div className={styles.profitRow}>
                                    <div className={styles.profitVal}>
                                        <span className={styles.label}>Retorno Final</span>
                                        <span className={styles.value}>${finalUSD.toFixed(2)} USD</span>
                                    </div>
                                    <div className={styles.profitVal}>
                                        <span className={styles.label}>Ganancia Neta</span>
                                        <span className={`${styles.value} ${profitPercent > 0 ? styles.positive : styles.negative}`}>
                                            {profitPercent > 0 ? '+' : ''}{profitPercent.toFixed(2)}%
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <footer className={styles.footer}>
                    <p>⚠️ Datos informativos basados en tasas actuales. Las comisiones bancarias finales pueden variar.</p>
                </footer>
            </div>
        </div>
    );
};

export default VESArbitrageModal;
