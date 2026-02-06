
import express from 'express';
import cors from 'cors';
import predictionRouter from './api/prediction-router.js';
import * as trader from './api/paper-trader.js';

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/prediction', predictionRouter);

app.get('/api/trader/status', (req, res) => {
    res.json({ ...trader.getPortfolio(), settings: trader.getConfig() });
});

app.post('/api/trader/close', (req, res) => {
    const { symbol } = req.body;
    const success = trader.manualClose(symbol);
    res.json({ status: success ? 'closed' : 'not_found' });
});

// START BOT LOOP
setInterval(async () => {
    try {
        await trader.tick();
    } catch (e) {
        console.error("Bot Tick Error:", e);
    }
}, 10000); // Check every 10 seconds

const PORT = 4000;
app.listen(PORT, () => {
    console.log(`📡 ARBITRAGE SCANNER SERVER running on http://localhost:${PORT}`);
});
