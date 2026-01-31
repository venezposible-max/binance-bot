import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// --- EMERGENCY SW CLEANUP ---
// Fixes Chrome caching issues by killing old Service Workers
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (let registration of registrations) {
        console.log('DOMINATOR: Unregistering Service Worker:', registration);
        registration.unregister().then(() => {
          console.log('Service Worker Unregistered. Reloading...');
          // Optional: window.location.reload() - but valid SW might re-register.
          // Just unregistering clears the poisoned cache for next visit.
        });
      }
    });
  });
}

import ErrorBoundary from './components/ErrorBoundary.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
