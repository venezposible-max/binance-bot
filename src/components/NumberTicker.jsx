import React, { useEffect, useState } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

const NumberTicker = ({ value, decimals = 2, prefix = '', suffix = '', className, style }) => {
    // Spring physics for smooth animation
    const spring = useSpring(value, { stiffness: 100, damping: 20 });
    const display = useTransform(spring, (current) => {
        // Format logic
        if (current === 0) return "0.00";
        if (current < 1) return current.toFixed(8);
        if (current < 10) return current.toFixed(4);
        return current.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    });

    useEffect(() => {
        spring.set(value);
    }, [value, spring]);

    return (
        <span className={className} style={{ display: 'inline-flex', ...style }}>
            {prefix}
            <motion.span>{display}</motion.span>
            {suffix}
        </span>
    );
};

export default NumberTicker;
