import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { clearPersistedSessionKeys, installBootRecovery } from './boot-recovery';
import { installImmersiveInputGuard } from './lib/fullscreen';
import { shouldRegisterServiceWorker } from './lib/sw-cache';
import './index.css';

installImmersiveInputGuard();

if (
  shouldRegisterServiceWorker(import.meta.env.PROD, 'serviceWorker' in navigator)
) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

// Force a clean slate when landing with ?reset=1
if (new URLSearchParams(window.location.search).has('reset')) {
  clearPersistedSessionKeys();
  window.location.replace('/');
} else {
  installBootRecovery();

  const rootEl = document.getElementById('root');
  if (!rootEl) {
    throw new Error('Root element #root not found');
  }

  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
