const grid = document.getElementById('grid');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const totalSaved = document.getElementById('total-saved');

const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const btnCancel = document.getElementById('btn-cancel');
const btnConfirm = document.getElementById('btn-confirm');
const spinner = document.getElementById('spinner');
const btnText = document.querySelector('.btn-text');
const modalError = document.getElementById('modal-error');

let selectedEnvelope = null;
let envelopesState = {};

async function fetchProgress() {
    try {
        const res = await fetch('/api/sobres/progress');
        envelopesState = await res.json();
        renderGrid();
        updateStats();
    } catch (e) {
        console.error('Error fetching progress:', e);
    }
}

function renderGrid() {
    grid.innerHTML = '';
    for (let i = 1; i <= 100; i++) {
        const div = document.createElement('div');
        div.className = 'envelope' + (envelopesState[i] ? ' completed' : '');
        div.textContent = i;
        div.onclick = () => {
            if (!envelopesState[i]) openModal(i);
        };
        grid.appendChild(div);
    }
}

function updateStats() {
    let completedCount = 0;
    let savedAmount = 0;
    for (let i = 1; i <= 100; i++) {
        if (envelopesState[i]) {
            completedCount++;
            savedAmount += i;
        }
    }
    
    progressText.textContent = `${completedCount} / 100`;
    totalSaved.textContent = `$${savedAmount.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
    
    const percentage = (completedCount / 100) * 100;
    progressBar.style.width = percentage + '%';
}

function openModal(id) {
    selectedEnvelope = id;
    modalTitle.textContent = `¿Ahorrar $${id} USDT?`;
    modalError.textContent = '';
    modal.classList.add('active');
}

function closeModal() {
    modal.classList.remove('active');
    selectedEnvelope = null;
}

btnCancel.onclick = closeModal;

btnConfirm.onclick = async () => {
    if (!selectedEnvelope) return;
    
    // UI state
    btnText.style.display = 'none';
    spinner.style.display = 'block';
    btnConfirm.disabled = true;
    modalError.textContent = '';
    
    try {
        // 1. Petición a Binance
        const binanceRes = await fetch('/api/sobres/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: selectedEnvelope, asset: 'USDT' })
        });
        
        const binanceData = await binanceRes.json();
        
        if (!binanceRes.ok) {
            throw new Error(binanceData.error || 'Error en Binance');
        }
        
        // 2. Si Binance fue exitoso, guardamos progreso local
        const saveRes = await fetch('/api/sobres/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ envelopeId: selectedEnvelope, completed: true })
        });
        
        if (saveRes.ok) {
            envelopesState[selectedEnvelope] = true;
            renderGrid();
            updateStats();
            closeModal();
        } else {
            throw new Error('Error guardando progreso local');
        }
        
    } catch (error) {
        modalError.textContent = error.message;
    } finally {
        btnText.style.display = 'block';
        spinner.style.display = 'none';
        btnConfirm.disabled = false;
    }
};

// Start
fetchProgress();
