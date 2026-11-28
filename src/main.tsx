import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

if (import.meta.env.PROD && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const hadController = Boolean(navigator.serviceWorker.controller);
    const notifyUpdate = () => {
      window.dispatchEvent(new CustomEvent('privaguard:sw-updated'));
    };

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) {
        notifyUpdate();
      }
    });

    const registerSw = () => {
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          if (reg.waiting && hadController) {
            notifyUpdate();
          }
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                notifyUpdate();
              }
            });
          });
          return reg.update().catch(() => {});
        })
        .catch(() => {
          // Ignore service worker registration errors in restricted contexts
        });
    };

    const idleWin = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (typeof idleWin.requestIdleCallback === 'function') {
      idleWin.requestIdleCallback(registerSw, { timeout: 2000 });
    } else {
      window.setTimeout(registerSw, 500);
    }
  });
}
