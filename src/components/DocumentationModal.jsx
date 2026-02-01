import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Book, ShieldCheck, Waves, Target, Zap, Layers, X, Info } from 'lucide-react';
import styles from './DocumentationModal.module.css';

const DocumentationModal = ({ isOpen, onClose }) => {
    const modes = [
        {
            id: 'swing',
            title: 'MODO SWING (Reversión de Tendencia)',
            icon: <ShieldCheck className={styles.modeIcon} size={28} />,
            description: 'Diseñado para capturar rebotes en zonas de capitulación dentro de una tendencia alcista macro. Es el modo más equilibrado del sistema.',
            indicators: ['RSI (14)', 'Bandas de Bollinger (20, 2)', 'EMA 200 (Filtro Macro)'],
            logic: 'Entra cuando el precio está sobrevendido (RSI < 30) Y toca la banda inferior de Bollinger, siempre que el precio esté por encima de la EMA 200.'
        },
        {
            id: 'flow',
            title: 'MODO FLOW (Desequilibrio de Ordenes)',
            icon: <Waves className={styles.modeIcon} size={28} />,
            description: 'Ignora los indicadores técnicos tradicionales para centrarse en la presión real del Libro de Órdenes (Order Book). Detecta muros de compra.',
            indicators: ['Order Book Depth (Top 20)', 'Buy/Sell Pressure Ratio'],
            logic: 'Analiza los muros de compra y venta. Una señal "STRONG BUY" se genera cuando el volumen de compra duplica al de venta (Ratio > 2.0x).'
        },
        {
            id: 'triple',
            title: 'MODO TRIPLE LOUPE (Confluencia Temporal)',
            icon: <Layers className={styles.modeIcon} size={28} />,
            description: 'El modo de mayor seguridad. Busca que tres marcos temporales diferentes se pongan de acuerdo antes de autorizar una entrada.',
            indicators: ['RSI (15m)', 'RSI (1h)', 'RSI (4h)'],
            logic: 'Solo dispara una señal si el activo está en zona de sobreventa (RSI < 30) en las gráficas de 15 minutos, 1 hora y 4 horas simultáneamente.'
        },
        {
            id: 'sniper',
            title: 'CVD SNIPER (Rastreo de Ballenas)',
            icon: <Target className={styles.modeIcon} size={28} />,
            description: 'Monitoreo en tiempo real vía WebSockets de transacciones individuales de gran capital (Ballenas) en el par BTCUSDT.',
            indicators: ['CVD (Cumulative Volume Delta)', 'WebSocket Tick Data'],
            logic: 'Rastrea el delta de volumen acumulado. Entra de forma agresiva cuando detecta una orden única o un clúster que supera el umbral de USDT configurado.'
        },
        {
            id: 'scalp',
            title: 'MODO SCALP (Alta Frecuencia)',
            icon: <Zap className={styles.modeIcon} size={28} />,
            description: 'Búsqueda de beneficios rápidos en micro-caídas del mercado. Ideal para periodos de alta volatilidad diaria.',
            indicators: ['RSI (14)', 'Velas de 5 Minutos'],
            logic: 'Detecta fatiga instantánea en marcos temporales cortos (5m). Entra en sobreventa máxima para capturar rebotes rápidos de poco porcentaje.'
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

                        <footer style={{ textAlign: 'center', marginTop: '40px', color: '#4B5563', fontSize: '0.8rem' }}>
                            BINANCE SENTINEL AI v4.0 • SISTEMA AUTÓNOMO DE ALTA PRECISIÓN
                        </footer>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default DocumentationModal;
