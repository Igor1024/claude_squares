// Service Worker — cache-first strategy for full offline support.
// Relative asset paths resolve against the SW scope, so this works on both
// root deploys and subpath deploys (e.g. GitHub Pages https://user.github.io/repo/).
const CACHE = 'pixel-art-v2';

const ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'sw.js',
  'src/app.js',
  'src/canvas.js',
  'src/tools.js',
  'src/storage.js',
  'src/ui.js',
  'src/onboarding.js',
  'src/print.js',
  'src/pwa.js',
  'assets/style.css',
  'assets/print.css',
  'assets/icon-192.svg',
  'assets/icon-512.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      // Per-asset add so a single failed request doesn't abort the whole install.
      Promise.allSettled(ASSETS.map(url => cache.add(url)))
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  if (event.request.url.includes('fonts.googleapis.com') ||
      event.request.url.includes('fonts.gstatic.com')) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE + '-fonts').then(c => c.put(event.request, clone));
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(event.request, clone));
        }
        return resp;
      });
    })
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});