import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        this.setState({ error, errorInfo });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    padding: '20px',
                    color: '#ef4444',
                    backgroundColor: '#0d1117',
                    height: '100vh',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'monospace',
                    textAlign: 'center'
                }}>
                    <h1>⚠️ Algo salió mal</h1>
                    <p>La aplicación ha encontrado un error crítico.</p>
                    <div style={{
                        backgroundColor: '#1f2937',
                        padding: '15px',
                        borderRadius: '8px',
                        maxWidth: '80%',
                        overflow: 'auto',
                        textAlign: 'left',
                        marginBottom: '20px'
                    }}>
                        <pre>{this.state.error?.toString()}</pre>
                    </div>
                    <button
                        onClick={() => {
                            localStorage.clear();
                            window.location.reload();
                        }}
                        style={{
                            padding: '10px 20px',
                            backgroundColor: '#10B981',
                            color: 'white',
                            border: 'none',
                            borderRadius: '5px',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                        }}
                    >
                        Borrar Datos y Recargar
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
