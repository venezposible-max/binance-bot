import React, { useState, useEffect } from 'react';
import { Users, TrendingUp, ShieldAlert, Award, ChevronDown, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
        <div className="relative">
            {/* Oracle Icon Button */}
            <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-300 ${isOpen
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                        : 'bg-slate-800/40 text-slate-400 border border-slate-700/50 hover:border-cyan-500/30'
                    }`}
            >
                <div className="relative">
                    <Users size={18} />
                    <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ repeat: Infinity, duration: 2 }}
                        className="absolute -top-1 -right-1 w-2 h-2 bg-cyan-500 rounded-full"
                    />
                </div>
                <span className="text-xs font-bold tracking-wider hidden sm:block uppercase">Trader Oracle</span>
                <ChevronDown size={14} className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
            </motion.button>

            {/* Glassmorphism Dropdown */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute right-0 mt-3 w-72 z-[100] overflow-hidden"
                    >
                        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl p-4">
                            <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/5">
                                <div className="flex items-center gap-2">
                                    <Award className="text-cyan-400" size={16} />
                                    <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Top Alpha Trader</span>
                                </div>
                                <span className="text-[9px] bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded-full border border-cyan-500/20 font-mono">
                                    LIVE SYNC
                                </span>
                            </div>

                            {loading ? (
                                <div className="h-40 flex items-center justify-center">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {/* Trader Header */}
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 flex items-center justify-center">
                                            <span className="text-cyan-400 font-bold">{trader?.name?.charAt(0)}</span>
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-bold text-white">{trader?.name}</h4>
                                            <p className="text-[10px] text-slate-500 font-mono">ID: {Math.random().toString(36).substr(2, 9).toUpperCase()}</p>
                                        </div>
                                    </div>

                                    {/* Stats Grid */}
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="bg-slate-800/40 border border-slate-700/30 p-2 rounded-xl">
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <TrendingUp size={12} className="text-green-400" />
                                                <span className="text-[10px] text-slate-400 font-medium tracking-tight">ROI 90D</span>
                                            </div>
                                            <span className="text-sm font-bold text-green-400">+{trader?.roi90d?.toFixed(1)}%</span>
                                        </div>
                                        <div className="bg-slate-800/40 border border-slate-700/30 p-2 rounded-xl">
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <ShieldAlert size={12} className="text-red-400" />
                                                <span className="text-[10px] text-slate-400 font-medium tracking-tight">Drawdown</span>
                                            </div>
                                            <span className="text-sm font-bold text-red-400">{trader?.mdd?.toFixed(1)}%</span>
                                        </div>
                                        <div className="bg-slate-800/40 border border-slate-700/30 p-2 rounded-xl col-span-2 flex items-center justify-between">
                                            <div className="flex items-center gap-1.5">
                                                <Activity size={12} className="text-cyan-400" />
                                                <span className="text-[10px] text-slate-400 font-medium tracking-tight">Win Rate</span>
                                            </div>
                                            <span className="text-sm font-bold text-cyan-400">{trader?.winRate}%</span>
                                        </div>
                                    </div>

                                    {/* Action Footer */}
                                    <div className="pt-2">
                                        <button
                                            disabled
                                            className="w-full py-2 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-[11px] font-bold rounded-xl transition-all uppercase tracking-widest cursor-not-allowed opacity-50"
                                        >
                                            View Performance
                                        </button>
                                        <p className="text-[8px] text-center text-slate-600 mt-2 italic font-medium">
                                            *Autonomous selection based on risk profile
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default TraderOracle;
