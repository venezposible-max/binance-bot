import React, { useEffect, useState, useRef } from 'react';

const LogConsole = ({ onClose }) => {
    const [logs, setLogs] = useState([]);
    const bottomRef = useRef(null);

    const fetchLogs = async () => {
        try {
            const res = await fetch('/api/logs');
            const data = await res.json();
            if (data.logs) {
                setLogs(data.logs);
            }
        } catch (e) {
            console.error("Log fetch failed", e);
        }
    };

    useEffect(() => {
        fetchLogs();
        const interval = setInterval(fetchLogs, 2000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    return (
        <div style={{
            position: 'fixed',
            top: 0, left: 0, width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.85)',
            zIndex: 9999,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{
                width: '90%', height: '80%',
                background: '#0F172A',
                border: '1px solid #334155',
                borderRadius: '8px',
                display: 'flex', flexDirection: 'column',
                boxShadow: '0 0 50px rgba(0,0,0,0.5)'
            }}>
                {/* Header */}
                <div style={{
                    padding: '15px', borderBottom: '1px solid #334155',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: '#1E293B'
                }}>
                    <span style={{ color: '#F59E0B', fontWeight: 'bold' }}>🖥️ RAILWAY BACKEND LOGS (LIVE)</span>
                    <button
                        onClick={onClose}
                        style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '1.2rem', cursor: 'pointer' }}
                    >✕</button>
                </div>

                {/* Logs Area */}
                <div style={{
                    flex: 1,
                    padding: '15px',
                    overflowY: 'auto',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                    color: '#e2e8f0',
                    textAlign: 'left' // Explicitly align left for reading logs
                }}>
                    {logs.length === 0 && <p style={{ opacity: 0.5 }}>Connecting to Log Stream...</p>}

                    {logs.map((log, i) => {
                        const isError = log.includes('[ERROR]');
                        const isWarn = log.includes('[WARN]');
                        return (
                            <div key={i} style={{
                                marginBottom: '4px',
                                color: isError ? '#EF4444' : isWarn ? '#F59E0B' : '#10B981',
                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                paddingBottom: '2px'
                            }}>
                                {log}
                            </div>
                        );
                    })}
                    <div ref={bottomRef} />
                </div>
            </div>
        </div>
    );
};

export default LogConsole;
