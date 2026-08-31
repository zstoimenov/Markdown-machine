import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Registered only in a build, so the dev server and the fixture are never served
 * yesterday's bundle. The path is relative, which is what makes the same artifact
 * work at a root domain and under a GitHub Pages project path — the scope follows
 * the directory the worker is served from.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {
      // An unregistrable worker costs offline use and the install prompt, and
      // nothing else. The app reads from disk either way.
    });
  });
}
