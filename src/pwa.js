/**
 * pwa.js — Service Worker registration and update detection.
 */

let _waitingWorker = null;
let _updateCallback = null;

export function initPWA() {
  if (!('serviceWorker' in navigator)) return;

  // Relative path so it works on both root and subpath deploys (e.g. GitHub Pages /repo/).
  navigator.serviceWorker.register('sw.js').then(reg => {
    if (reg.waiting) { _waitingWorker = reg.waiting; _updateCallback?.(); }

    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          _waitingWorker = installing;
          _updateCallback?.();
        }
      });
    });
  }).catch(err => console.warn('SW registration failed:', err));

  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
}

export function onUpdateAvailable(cb) { _updateCallback = cb; }

export function applyUpdate() {
  if (_waitingWorker) _waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}