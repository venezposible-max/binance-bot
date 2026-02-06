import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Book, ShieldCheck, Waves, Target, Zap, Layers, X, Info } from 'lucide-react';
import styles from './DocumentationModal.module.css';

const DocumentationModal = ({ isOpen, onClose }) => {
    const modes = [
        {
            id: 'blitz-spot',
            title: 'ESTRATEGIA BLITZ: SPOT ALPHA (Alta Frecuencia)',
            icon: <Zap className={styles.modeIcon} style={{ color: '#00D9FF' }} size={28} />,
            description: 'Estrategia propietaria de ejecución rápida diseñada para mercados Spot. Busca ineficiencias de precio en temporalidades cortas (1m/5m) para capturar rebotes técnicos con precisión quirúrgica, sin riesgo de liquidación por apalancamiento.',
            indicators: ['RSI Estocástico', 'Price Action Concepts (SMC)', 'Order Block Detection'],
            logic: 'Detección de sobreventa extrema en zonas de demanda institucional. El sistema no "adivina", reacciona a la liquidez.',
            examples: [
                {
                    title: 'Escenario de Compra Ideal',
                    text: 'El precio de BTC cae bruscamente un 2% en 5 minutos. El RSI toca 25 (Sobreventa) y el precio entra en un "Order Block" (zona de compras anteriores). BLITZ detecta la confluencia y ejecuta una compra de mercado.'
                },
                {
                    title: 'Gestión de Salida (Take Profit)',
                    text: 'Una vez dentro, el bot coloca órdenes de venta escalonadas. Si el precio sube un 1.5%, asegura ganancias. Si baja más, espera (HODL) ya que en Spot no hay liquidación, aprovechando la recuperación natural del activo.'
                }
            ]
        },
        {
            id: 'hybrid-protect',
            title: 'HYBRID PROTECT: FILTRO GENÉTICO',
            icon: <ShieldCheck className={styles.modeIcon} style={{ color: '#8B5CF6' }} size={28} />,
            description: 'Un "portero" inteligente que valida todas las señales del bot técnico antes de dejarlas pasar. Utiliza modelos probabilísticos basados en historia reciente para evitar "trampas de mercado".',
            indicators: ['Odds Probability (Calculated)', 'Volatility Context'],
            logic: 'Si el Bot Técnico dice "COMPRA", el Filtro Genético pregunta: "¿Qué probabilidad tiene este patrón de ganar hoy?". Si la respuesta es menor que tu umbral configurado (ej. 67%), la operación se bloquea para proteger tu capital.',
            examples: [
                {
                    title: 'Filtrado de Señal Débil',
                    text: 'El bot detecta una compra en PEPEUSDT. El filtro calcula que, dada la volatilidad actual, la probabilidad de éxito es solo del 45%. Como tú configuraste el mínimo en 60%, la operación se descarta.'
                },
                {
                    title: 'Configuración de Riesgo',
                    text: 'Puedes ajustar este filtro en ⚙️ CONFIG. Un valor alto (70%+) hará que el bot sea muy selectivo (pocas operaciones, alta seguridad). Un valor bajo (40%) permitirá más operaciones con mayor riesgo.'
                }
            ]
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
                                        <strong>LÓGICA OPERATIVA:</strong> {mode.logic}
                                    </div>
                                </div>

                                {mode.examples && (
                                    <div style={{ marginTop: '15px', display: 'grid', gap: '10px' }}>
                                        {mode.examples.map((ex, idx) => (
                                            <div key={idx} style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '10px', borderRadius: '8px', borderLeft: '3px solid #00D9FF' }}>
                                                <div style={{ fontWeight: 'bold', fontSize: '0.85rem', color: '#fff', marginBottom: '4px' }}>📌 {ex.title}</div>
                                                <div style={{ fontSize: '0.8rem', color: '#cbd5e1', lineHeight: '1.4' }}>{ex.text}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
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
