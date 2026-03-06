import { Connection } from '@solana/web3.js';

const checkLatestWhales = async () => {
    try {
        const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
        const latestSlot = await connection.getSlot();
        console.log(`Current Slot: ${latestSlot}`);

        for (let i = 0; i < 5; i++) {
            const slot = latestSlot - i;
            console.log(`\n--- Checking Slot ${slot} ---`);
            try {
                const block = await connection.getBlock(slot, {
                    maxSupportedTransactionVersion: 0,
                    transactionDetails: 'full'
                });

                if (!block || !block.transactions) continue;

                block.transactions.forEach(t => {
                    if (!t.meta) return;
                    const diff = (t.meta.preBalances[0] - t.meta.postBalances[0]) / 1e9;

                    if (diff > 5) {
                        const hasTokens = t.meta.postTokenBalances.length > 0;
                        console.log(`- Tx: ${t.transaction.signatures[0].substring(0, 8)} | Amount: ${diff.toFixed(2)} SOL | HasTokens: ${hasTokens}`);
                    }
                });
            } catch (e) {
                console.log(`Error reading slot ${slot}: ${e.message}`);
            }
        }
    } catch (e) {
        console.error("Error checking Solana:", e.message);
    }
};

checkLatestWhales();
