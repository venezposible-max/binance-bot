// Simple Circular Buffer for Logs
const MAX_LOGS = 100;
const logs = [];

export const LogStore = {
    add: (type, ...args) => {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0]; // HH:MM:SS
        const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');

        logs.push(`[${timestamp}] [${type.toUpperCase()}] ${message}`);

        if (logs.length > MAX_LOGS) {
            logs.shift();
        }
    },

    get: () => logs
};

export default LogStore;
