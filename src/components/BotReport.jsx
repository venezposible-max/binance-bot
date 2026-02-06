import React from 'react';
import styles from './BotReport.module.css';
import { ShieldCheck, Brain, Activity, Zap, History } from 'lucide-react';

const BotReport = ({ config, cloudStatus }) => {
    const blacklistCount = cloudStatus?.blacklist?.length || 0;
    const strategyConf = config?.strategyConfig?.HYBRID_BLITZ || {};
    const useBlitz = strategyConf.useBlitz !== false;
    const useHybrid = strategyConf.useHybrid !== false;
    const minOdds = strategyConf.minOdds || 67;

    let strategyName = 'MONITOR (INACTIVO)';
    if (useBlitz && useHybrid) strategyName = 'FUSIÓN (TÉCN + ESTAD)';
    else if (useBlitz) strategyName = 'BLITZ (TÉCNICO)';
    else if (useHybrid) strategyName = 'HYBRID (ESTADÍSTICO)';

    return (
        <div className={styles.reportContainer}>
            <div className={styles.header}>
                <ShieldCheck size={18} color="#10B981" />
                <span className={styles.title}>INFORME DEL SISTEMA</span>
            </div>

            <div className={styles.statsGrid}>
                <div className={styles.statItem}>
                    <div className={styles.statLabel}>
                        <Zap size={12} /> ESTRATEGIA
                    </div>
                    <div className={styles.statValue} style={{ fontSize: '0.8rem' }}>{strategyName}</div>
                </div>

                <div className={styles.statItem}>
                    <div className={styles.statLabel}>
                        <Brain size={12} /> FILTRO ELITE
                    </div>
                    <div className={styles.statValue}>+{minOdds}% Prob.</div>
                </div>



                <div className={styles.statItem}>
                    <div className={styles.statLabel}>
                        <Activity size={12} /> ESCANEO
                    </div>
                    <div className={styles.statValue}>12 Pares (Live)</div>
                </div>
            </div>

            <div className={styles.footer}>
                <div className={styles.pulseDot}></div>
                Status: Sistema Vigilando
            </div>
        </div>
    );
};

export default React.memo(BotReport);
