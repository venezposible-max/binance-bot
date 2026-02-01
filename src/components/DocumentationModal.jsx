import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Book, ShieldCheck, Waves, Target, Zap, Layers, X, Info } from 'lucide-react';
import styles from './DocumentationModal.module.css';

const DocumentationModal = ({ isOpen, onClose }) => {
    const modes = [
        {
            id: 'hybrid-swing',
            title: 'HYBRID ENGINE: SWING (Institucional)',
            icon: <ShieldCheck className={styles.modeIcon} style={{ color: '#00D9FF' }} size={28} />,
            description: 'Motor de confluencia avanzado que fusiona Order Blocks, Presión de Flujo y Tendencia Macro. Optimizado para capturar giros de mercado en temporalidades de 1H/4H.',
            indicators: ['Order Blocks', 'Buy/Sell Flow', 'EMA 200', 'RSI Confluence'],
            logic: 'Exige confluencia triple: 1. Precio en zona OB. 2. Presión de compra > 1.5x. 3. Tendencia confirmada. Es el modo de mayor precisión.'
        },
        {
            id: 'hybrid-blitz',
            title: 'HYBRID ENGINE: BLITZ (Alta Frecuencia)',
            icon: <Zap className={styles.modeIcon} style={{ color: '#F59E0B' }} size={28} />,
            description: 'Versión ultrasensible del motor Híbrido. Diseñado para detectar micro-desequilibrios en el libro de órdenes y atrapar rebotes rápidos en 1m.',
            indicators: ['Order Book Skew', 'Momentum de 1m', 'Turbo Impulse (1.0%)'],
            logic: 'Usa umbrales reducidos (Impulso 1.0% y Flow 1.2x) para disparar con mayor frecuencia. Ideal para capturar micro-tendencias.'
        },
        {
            id: 'ai-brain',
            title: 'AI BRAIN: REGIME & KELLY (Fase 5)',
            icon: <Layers className={styles.modeIcon} style={{ color: '#FFA500' }} size={28} />,
            description: 'El cerebro del sistema. Analiza el clima global del mercado y ajusta el comportamiento del bot de forma autónoma.',
            indicators: ['ADX (Regime)', 'Kelly Criterion (Risk)', 'Streak Analysis'],
            logic: 'Detecta si el mercado es TENDENCIAL o LATERAL. Ajusta el multiplicador de riesgo (Kelly) según tu racha de acierto para proteger el capital.'
        },
        {
            id: 'sniper',
            title: 'CVD SNIPER (Rastreo de Ballenas)',
            icon: <Target className={styles.modeIcon} style={{ color: '#D946EF' }} size={28} />,
            description: 'Monitoreo vía WebSockets de transacciones individuales de gran capital (Ballenas) en tiempo real.',
            indicators: ['CVD (Cumulative Volume Delta)', 'Whale Cluster Detection'],
            logic: 'Rastrea el delta de volumen acumulado. Dispara cuando detecta una orden única o un clúster que supera el umbral de ballenas configurado.'
        },
        {
            id: 'atr-risk',
            title: 'ATR PRECISION (Gestión de Riesgo)',
            icon: <ShieldCheck className={styles.modeIcon} style={{ color: '#10B981' }} size={28} />,
            description: 'Sistema de salidas dinámicas basadas en la volatilidad real del mercado (Average True Range). No usa stops fijos.',
            indicators: ['ATR (14)', 'Dynamic TP/SL', 'Volatility Multipliers'],
            logic: 'Calcula el Stop Loss y el Take Profit basándose en la "respiración" del activo. Evita que el ruido del mercado te saque de una buena posición.'
        }
    ];

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className={styles.overlay}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    <motion.div
                        className={styles.modal}
                        initial={{ scale: 0.9, y: 20, opacity: 0 }}
                        animate={{ scale: 1, y: 0, opacity: 1 }}
                        exit={{ scale: 0.9, y: 20, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 300, damping: 25 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button className={styles.closeBtn} onClick={onClose} aria-label="Cerrar">
                            <X size={24} />
                        </button>

                        <h1 className={styles.title}>
                            <Book size={32} style={{ verticalAlign: 'middle', marginRight: '15px' }} />
                            CENTRO DE DOCUMENTACIÓN
                        </h1>

                        {modes.map((mode) => (
                            <div key={mode.id} className={styles.section}>
                                <div className={styles.sectionHeader}>
                                    {mode.icon}
                                    <h2 className={styles.modeTitle}>{mode.title}</h2>
                                </div>
                                <p className={styles.description}>{mode.description}</p>

                                <div className={styles.indicators}>
                                    {mode.indicators.map((ind, i) => (
                                        <span key={i} className={styles.indicatorTag}>{ind}</span>
                                    ))}
                                </div>

                                <div className={styles.logicInfo}>
                                    <div className={styles.logicText}>
                                        <Info size={16} />
                                        <strong>LÓGICA DE ENTRADA:</strong> {mode.logic}
                                    </div>
                                </div>
                            </div>
                        ))}

                        <div className={styles.section} style={{ borderBottom: 'none', background: 'rgba(239, 68, 68, 0.05)', padding: '20px', borderRadius: '16px', marginTop: '20px' }}>
                            <div className={styles.sectionHeader}>
                                <ShieldCheck className={styles.modeIcon} style={{ color: '#EF4444' }} size={28} />
                                <h2 className={styles.modeTitle} style={{ color: '#EF4444' }}>⚠️ DESCARGO DE RESPONSABILIDAD (RISK NOTICE)</h2>
                            </div>
                            <p className={styles.description} style={{ color: '#FCA5A5', fontWeight: '500' }}>
                                El trading de criptoactivos es altamente impredecible. Los mercados pueden moverse de manera irracional, rompiendo patrones técnicos y algoritmos en segundos.
                                <br /><br />
                                <strong>REGLA DE ORO:</strong> Nunca arriesgues capital que no estés dispuesto a perder en su totalidad. Este bot es una herramienta de asistencia, no una garantía de ganancias. La responsabilidad final de cada operación recae exclusivamente en el usuario.
                            </p>
                        </div>

                        <footer style={{ textAlign: 'center', marginTop: '40px', color: '#4B5563', fontSize: '0.8rem' }}>
                            BINANCE SENTINEL AI v5.0 • SISTEMA AUTÓNOMO DE ALTA PRECISIÓN • NFA (Not Financial Advice)
                        </footer>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default DocumentationModal;
