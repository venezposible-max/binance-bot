---
name: Alpha Trader Discovery
description: A rigorous heuristic for identifying the most profitable and safe Copy Traders on Binance.
version: 1.0.0
---

# 🧠 Alpha Trader Discovery Protocol

This skill enables the Sentinel Bot to mathematically rank and identify real traders who offer the best balance between **Profitability** and **Safety**.

## 1. The "Alpha Score" Formula 🧮

We do not just look at ROI. We calculate a composite score to find the "Holy Grail" of traders.

```javascript
/*
  Alpha Score = (Consistency * Efficiency) / Risk
*/

const MonthlyROI = trader.roiMonthly; // e.g., 20%
const WinRate = trader.winRate;       // e.g., 90%
const MaxDrawdown = trader.mdd;       // e.g., 5%

// The Formula:
// 1. Reward high Win Rate + ROI.
// 2. Punish Drawdown exponentially (a 20% drop is 4x worse than a 10% drop).
let score = (MonthlyROI * (WinRate / 100)); 
score = score / (MaxDrawdown || 1); // Protect against divide by zero

// Bonus for Tenure (if available) -> implied by name recognition
```

**Interpretation:**
- Score > 10: **Legendary** (Unstoppable money printer)
- Score > 5: **Elite** (Excellent professional)
- Score < 2: **Mediocre** (Avoid)

## 2. Categorization Profiles 📂

The skill sorts traders into styles so the user finds *their* match:

| Profile | Focus | Ideal Metrics |
| :--- | :--- | :--- |
| **THE SNIPER** | High Risk, High Reward | ROI > 50%, MDD < 10% |
| **THE BANKER** | Safe, Steady Growth | ROI 5-10%, MDD < 2% |
| **THE MACHINE** | High Frequency, Algo | Win Rate > 90% |

## 3. Deployment Strategy 🚀

1.  **Scanner**: Runs the `Alpha Score` on the database of known top traders.
2.  **Filter**: Eliminates anyone with MDD > 20% (Too risky).
3.  **Ranking**: Sorts by Score descending.
4.  **Presentation**: Displays the "Alpha Score" badge to the user as proof of quality.
