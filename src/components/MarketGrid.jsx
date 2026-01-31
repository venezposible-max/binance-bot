import React from 'react';
import styles from './MarketGrid.module.css';

const MarketGrid = ({ children }) => {
    return (
        <div className={styles.grid}>
            {children}
        </div>
    );
};

export default React.memo(MarketGrid);
