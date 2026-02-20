import React from 'react';
import styles from './BotReport.module.css';
import { ShieldCheck, Brain, Activity, Zap, History, Settings } from 'lucide-react';
import { API_BASE } from '../config/api';

const BotReport = ({ config, cloudStatus }) => {
    const blacklistCount = cloudStatus?.blacklist?.length || 0;
    const strategyConf = config?.strategyConfig?.HYBRID_VORTEX || {};
    const useVortex = strategyConf.useVortex !== false;
    const useHybrid = strategyConf.useHybrid !== false;
    const useUnixa = strategyConf.useUnixa === true;
    const minOdds = strategyConf.minOdds || 67;

    let activeModules = [];
    if (useVortex) activeModules.push('VORTEX');
    if (useHybrid) activeModules.push('HYBRID');
    if (useUnixa) activeModules.push('UNIXA');

    let strategyName = activeModules.length > 0 ? activeModules.join(' + ') : 'MONITOR (INACTIVO)';

    const [displayOdds, setDisplayOdds] = React.useState(minOdds);

    // Sync local state when prop updates (from server polling)
    React.useEffect(() => {
        setDisplayOdds(minOdds);
    }, [minOdds]);

    const handleEditOdds = async () => {
        const newOddsStr = prompt(`🧬 Ajustar Filtro de Probabilidad (Actual: ${displayOdds}%) \n\nIntroduce el nuevo porcentaje mínimo (50-95):`, displayOdds);
        if (newOddsStr === null) return;

        const newOdds = parseInt(newOddsStr);
        if (isNaN(newOdds) || newOdds < 10 || newOdds > 100) {
            alert("Por favor introduce un número válido entre 10 y 100");
            return;
        }

        // OPTIMISTIC UPDATE: Update UI immediately
        setDisplayOdds(newOdds);

        const newStrategyConfig = {
            ...config?.strategyConfig,
            HYBRID_VORTEX: {
                ...strategyConf,
                minOdds: newOdds
            }
        };

        try {
            await fetch(`${API_BASE}/api/wallet/config?mode=${config.tradingMode || 'SIMULATION'}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    strategyConfig: newStrategyConfig,
                    tradingMode: config.tradingMode
                })
            });
            // UX Feedback: simple alert for now, polling will update UI shortly
            // alert(`✅ Filtro actualizado a ${newOdds}%`); 
        } catch (e) {
            console.error("Error updating odds:", e);
            alert("❌ Error al guardar configuración");
            setDisplayOdds(minOdds); // Revert on error
        }
    };

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
                    <div className={styles.statValue} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>+{displayOdds}% Prob.</span>
                        <Settings
                            size={12}
                            style={{ cursor: 'pointer', opacity: 0.7 }}
                            onClick={handleEditOdds}
                            onMouseEnter={(e) => e.target.style.opacity = 1}
                            onMouseLeave={(e) => e.target.style.opacity = 0.7}
                        />
                    </div>
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
