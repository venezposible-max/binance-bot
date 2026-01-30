import React from 'react';
import { LayoutDashboard, Wallet, Bolt } from 'lucide-react';
import { motion } from 'framer-motion';
import styles from './MobileNavbar.module.css';

const MobileNavbar = ({ activeTab, onTabChange }) => {
    const tabs = [
        { id: 'dashboard', icon: <LayoutDashboard size={24} />, label: 'Market' },
        { id: 'wallet', icon: <Wallet size={24} />, label: 'Wallet' },
        { id: 'settings', icon: <Bolt size={24} />, label: 'Config' }
    ];

    return (
        <div className={styles.navbar}>
            {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                    <button
                        key={tab.id}
                        className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                        onClick={() => onTabChange(tab.id)}
                    >
                        <div className={styles.iconWrapper}>
                            {tab.icon}
                            {isActive && (
                                <motion.div
                                    layoutId="navIndicator"
                                    className={styles.indicator}
                                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                />
                            )}
                        </div>
                        <span className={styles.label}>{tab.label}</span>
                    </button>
                )
            })}
        </div>
    );
};

export default MobileNavbar;
