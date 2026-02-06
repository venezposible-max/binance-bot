
import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../config/api';

export function useWallet() {
    const [tradingMode, setTradingMode] = useState('SIMULATION');
    const [activeStrategy, setActiveStrategy] = useState('BLITZ');
    const [timeframe, setTimeframe] = useState('5m');
    const [walletConfig, setWalletConfig] = useState({});

    // Cloud Status (Active Trades & History)
    const [cloudStatus, setCloudStatusState] = useState({ active: [], history: [], blacklist: [] });
    // Keep a Ref for internal polling if needed, though useMarketData handles the heavy lifting
    const cloudStatusRef = useRef({ active: [], history: [], blacklist: [] });

    // Other Global States from backend
    const [lockdown, setLockdown] = useState(false);
    const [apiConfigured, setApiConfigured] = useState(false);
    const [binanceBalance, setBinanceBalance] = useState(null);

    // Wrapper to sync Ref
    const setCloudStatus = (newStatusOrFn) => {
        setCloudStatusState(prev => {
            const newVal = typeof newStatusOrFn === 'function' ? newStatusOrFn(prev) : newStatusOrFn;
            cloudStatusRef.current = { ...prev, ...newVal };
            return newVal;
        });
    };

    // --- 1. Load Initial Mode & Config ---
    const loadModeAndConfig = useCallback(async () => {
        try {
            // Fetch Global Mode
            const modeRes = await fetch(`${API_BASE}/api/wallet/active-mode`);
            const { mode } = modeRes.ok ? await modeRes.json() : { mode: 'SIMULATION' };
            setTradingMode(mode);

            // Fetch Config
            // Fetch Config
            const configRes = await fetch(`${API_BASE}/api/wallet/config?mode=${mode}`);
            const data = configRes.ok ? await configRes.json() : null;

            if (data) {
                setWalletConfig(data);
                // Sync Strategy State
                if (data.strategy && data.strategy !== activeStrategy) {
                    setActiveStrategy(data.strategy);
                    localStorage.setItem('sentinel_strategy', data.strategy);
                    if (data.strategy.includes('BLITZ') || data.strategy === 'SCALP') setTimeframe('5m');
                    else if (data.strategy === 'TRIPLE') setTimeframe('15m');
                } else {
                    if (data.strategy && data.strategy.includes('BLITZ') && timeframe !== '5m') setTimeframe('5m');
                }
            }
        } catch (err) {
            console.error('Failed to sync mode/config:', err);
        }
    }, [activeStrategy, timeframe]);

    // --- 2. Poll Cloud Status & Balance ---
    const fetchCloudStatus = async (explicitMode = null) => {
        try {
            const modeToFetch = explicitMode || tradingMode;
            const res = await fetch(`${API_BASE}/api/get-status?mode=${modeToFetch}`);
            if (res.ok) {
                const data = await res.json();
                setCloudStatus({
                    active: data.active || [],
                    history: data.history || [],
                    blacklist: data.blacklist || []
                });
                setLockdown(data.lockdown || false);
                setApiConfigured(data.isApiConfigured || false);
            }
        } catch (err) {
            console.error('Cloud Status Sync Error:', err);
        }
    };

    const fetchBinanceBalance = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/wallet/balance`);
            if (res.ok) {
                const data = await res.json();
                setBinanceBalance(data);
            }
        } catch (e) { console.error("Balance fetch failed", e); }
    };

    // Init Effect
    useEffect(() => {
        loadModeAndConfig();
        fetchBinanceBalance();
        const interval = setInterval(fetchBinanceBalance, 20000); // 20s Balance Check
        return () => clearInterval(interval);
    }, []);

    // Polling Effect for Trades (Synced with Market Data loop usually, but here we can poll independently or let useMarketData rely on this)
    // Actually, App.jsx was calling fetchCloudStatus inside the main loop. 
    // To decouple, let's expose fetchCloudStatus and let the consumer call it, OR poll internally.
    // Ideally, cleaner if the Wallet manages its own state 100%. 
    // Let's add a fast poll for trade status here (2s) so UI is responsive even if chart is slow.
    useEffect(() => {
        const interval = setInterval(() => fetchCloudStatus(), 2000); // 2s Trade Sync
        return () => clearInterval(interval);
    }, [tradingMode]);


    // --- 3. Actions ---
    const toggleTradingMode = async (onFlush) => {
        try {
            const newMode = tradingMode === 'SIMULATION' ? 'LIVE' : 'SIMULATION';

            // Visual Flush Call
            if (onFlush) onFlush();

            // Optimistic Updates
            setCloudStatus({ active: [], history: [], blacklist: [] });
            setTradingMode(newMode);
            setWalletConfig({});

            const res = await fetch(`${API_BASE}/api/wallet/active-mode`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: newMode })
            });

            if (res.ok) {
                // Reload config for new mode
                // Reload config for new mode
                const configRes = await fetch(`${API_BASE}/api/wallet/config?mode=${newMode}`);
                if (configRes.ok) {
                    const configData = await configRes.json();
                    setWalletConfig(configData);
                }
                await fetchCloudStatus(newMode);
                console.log(`🌓 Mode toggled to: ${newMode}`);
            }
        } catch (e) {
            console.error("Toggle Mode Error:", e);
        }
    };

    const toggleLockdown = async () => {
        if (!confirm(lockdown ? '¿Desbloquear sistema y permitir operaciones?' : '⛔ ¿PARADA DE EMERGENCIA?\n\nEsto bloqueará todas las nuevas operaciones.')) return;
        try {
            const res = await fetch(`${API_BASE}/api/lockdown`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active: !lockdown })
            });
            if (res.ok) {
                const data = await res.json();
                setLockdown(data.lockdown);
            }
        } catch (e) { console.error('Lockdown failed', e); }
    };

    // Manual Trade Action
    const handleManualAction = async (action, data) => {
        try {
            const res = await fetch(`${API_BASE}/api/manual-trade`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ...data })
            });
            if (res.ok) {
                const result = await res.json();
                setCloudStatus(prev => ({ ...prev, active: result.active })); // Instant Optimistic Update
            }
        } catch (e) {
            console.error("Manual Action Error:", e);
        }
    };

    return {
        // State
        tradingMode,
        activeStrategy,
        timeframe,
        walletConfig,
        cloudStatus,
        lockdown,
        apiConfigured,
        binanceBalance,

        // Actions
        setActiveStrategy,
        setTimeframe,
        setWalletConfig, // For manual updates from components
        toggleTradingMode,
        toggleLockdown,
        handleManualAction,
        refreshConfig: loadModeAndConfig,
        fetchCloudStatus // Exposed if needed
    };
}
