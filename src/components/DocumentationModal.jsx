import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Book, ShieldCheck, Waves, Target, Zap, Layers, X, Info } from 'lucide-react';
import styles from './DocumentationModal.module.css';

const DocumentationModal = ({ isOpen, onClose }) => {
    const modes = [
        {
            id: 'smart-dip',
            title: 'ESTRATEGIA SMART DIP (Comprar el Dip)',
            icon: <Zap className={styles.modeIcon} style={{ color: '#10B981' }} size={28} />,
            description: 'Estrategia probabilística y conservadora para mercado Spot. Diseñada para operar exclusivamente sobre activos de alta capitalización (Top 20 en volumen) que tienden a rebotar rápido luego de caídas bruscas.',
            indicators: ['% de Caída de Precio (desde Máximo de 24h)', 'RSI (Sobreventa extrema)', 'Manejo de Trailing Stop Escalonado'],
            logic: 'El bot busca un "Dip" (caída fuerte) de al menos -3% desde el máximo de las últimas 24 horas, confirmando la validez de la entrada exigiendo además una condición de sobreventa extrema (RSI menor a 35) en temporalidades de 1 hora.',
            examples: [
                {
                    title: 'Entrada tipo HODL (Sin Stop Loss inicial)',
                    text: 'Ideada matemáticamente para spot, al entrar asume una mentalidad de acumulación (Hold) si el mercado cae fuertemente, eliminando las pérdidas forzadas ("Sin Stop Loss"). Espera pacientemente el rebote del mercado para sacar ganancia.'
                },
                {
                    title: 'Protección de Ganancia (Trailing Stop)',
                    text: 'Una vez el precio rebota a zona de ganancia, usa el mecanismo de candado. Al alcanzar +0.70% de ganancia, asegura la salida en +0.50%. Si llega a +0.90%, la asegura en +0.70%. Garantiza cerrar siempre en verde una vez alcanzado el umbral.'
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
                            BINANCE SMART DIP AI v6.0 • SISTEMA AUTÓNOMO DE ALTA PRECISIÓN • NFA (Not Financial Advice)
                        </footer>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default DocumentationModal;
