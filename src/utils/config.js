```
import axios from 'axios';

// --- SHARED CONFIG ---
// FORCE GLOBAL REGION
export const CONFIG = {
    REGION: 'EU',
    
    // API ENDPOINTS
    API: {
        BINANCE_GLOBAL: 'https://api.binance.com/api/v3',
        BINANCE_GCP: 'https://api-gcp.binance.com/api/v3'
    }
};

export const getBaseUrl = () => {
    // Since REGION is permanently 'EU', we can directly return BINANCE_GLOBAL
    return CONFIG.API.BINANCE_GLOBAL;
};
```
