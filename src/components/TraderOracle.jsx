import React, { useState, useEffect } from 'react';
import { Users, TrendingUp, ShieldAlert, Award, ChevronDown, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './TraderOracle.module.css';

const TraderOracle = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [trader, setTrader] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchTrader = async () => {
        try {
            const res = await fetch('/api/wallet/trader-oracle');
            if (res.ok) {
                const data = await res.json();
                setTrader(data);
            }
        } catch (error) {
            console.error('Error fetching Oracle trader:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTrader();
        const interval = setInterval(fetchTrader, 60000); // Sync every minute
        return () => clearInterval(interval);
    }, []);

    return (
        <div className={styles.oracleContainer}>
            {/* Oracle Icon Button */}
            <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setIsOpen(!isOpen)}
                className={`${styles.oracleButton} ${isOpen ? styles.oracleButtonOpen : ''}`}
            >
                <div className={styles.iconWrapper}>
                    <Users size={18} />
                    <motion.div
                        animate={{ scale: [1, 1.2, 1], opacity: [0.8, 1, 0.8] }}
                        transition={{ repeat: Infinity, duration: 2 }}
                        className={styles.pulseIndicator}
                    />
                </div>
                <span className={styles.btnText}>Trader Oracle</span>
                <ChevronDown size={14} style={{ transition: 'transform 0.3s', transform: isOpen ? 'rotate(180deg)' : 'none' }} />
            </motion.button>

            {/* Dropdown Menu */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className={styles.dropdown}
                    >
                        <div className={styles.dropdownHeader}>
                            <div className={styles.headerLeft}>
                                <Award className={styles.awardIcon} size={14} style={{ color: '#22d3ee' }} />
                                <span className={styles.headerTitle}>Top Alpha Trader</span>
                            </div>
                            <span className={styles.syncBadge}>LIVE SYNC</span>
                        </div>

                        {loading ? (
                            <div style={{ height: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div className="loader" style={{ width: '24px', height: '24px', border: '2px solid rgba(34, 211, 238, 0.1)', borderTopColor: '#22d3ee', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                            </div>
                        ) : (
                            <div className={styles.content}>
                                {/* Trader Header */}
                                <div className={styles.profile}>
                                    <div className={styles.avatar}>
                                        <span className={styles.avatarText}>{trader?.name?.charAt(0)}</span>
                                    </div>
                                    <div className={styles.traderInfo}>
                                        <h4>{trader?.name}</h4>
                                        <p className={styles.traderId}>ID: X16A7XYFZ</p>
                                    </div>
                                </div>

                                {/* Stats Grid */}
                                <div className={styles.statsGrid}>
                                    <div className={styles.statBox}>
                                        <div className={styles.statHeader}>
                                            <TrendingUp size={12} style={{ color: '#4ade80' }} />
                                            <span className={styles.statLabel}>ROI 90D</span>
                                        </div>
                                        <span className={`${styles.statValue} ${styles.roi}`}>+{trader?.roi90d?.toFixed(1)}%</span>
                                    </div>
                                    <div className={styles.statBox}>
                                        <div className={styles.statHeader}>
                                            <ShieldAlert size={12} style={{ color: '#f87171' }} />
                                            <span className={styles.statLabel}>Drawdown</span>
                                        </div>
                                        <span className={`${styles.statValue} ${styles.mdd}`}>{trader?.mdd?.toFixed(1)}%</span>
                                    </div>
                                    <div className={`${styles.statBox} ${styles.winRateBox}`}>
                                        <div className={styles.statHeader}>
                                            <Activity size={12} style={{ color: '#22d3ee' }} />
                                            <span className={styles.statLabel}>Win Rate</span>
                                        </div>
                                        <span className={`${styles.statValue} ${styles.winRate}`}>{trader?.winRate}%</span>
                                    </div>
                                </div>

                                {/* Footer Action */}
                                <div className={styles.footer}>
                                    <button className={styles.actionBtn}>View Performance</button>
                                    <p className={styles.disclaimer}>*Autonomous selection based on risk profile</p>
                                </div>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
            <style dangerouslySetInnerHTML={{
                __html: `
                @keyframes spin { to { transform: rotate(360deg); } }
            ` }} />
        </div>
    );
};

export default TraderOracle;
