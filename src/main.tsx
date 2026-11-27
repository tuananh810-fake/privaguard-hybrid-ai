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
    const registerSw = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
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
