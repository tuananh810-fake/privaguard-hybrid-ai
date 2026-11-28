const CACHE_NAME = 'privaguard-shell-v7.1.0';
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/samples/nda-sample.pdf',
  '/samples/id-card-sample.png',
];

const BLOCKED_HOST_PATTERNS = [
  'firebaseio.com',
  'googleapis.com',
  'google.com',
  'gstatic.com',
  'recaptcha.net',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
];

function isBlockedApiRequest(url) {
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOST_PATTERNS.some((h) => host === h || host.endsWith('.' + h))) {
    return true;
  }
  if (url.pathname.startsWith('/__/')) {
    return true;
  }
  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll(APP_SHELL_URLS.map((url) => new Request(url, { cache: 'reload' })))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache Firebase, Google APIs, reCAPTCHA, or any cross-origin requests
  if (url.origin !== self.location.origin || isBlockedApiRequest(url)) {
    return;
  }

  // Navigation requests: network-first (bypass stale HTTP cache), fall back to cached app shell when offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Hashed build assets, samples, local tesseract assets: cache-first with runtime populate
  const isCacheablePath =
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/samples/') ||
    url.pathname.startsWith('/tesseract/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/icon.svg' ||
    url.pathname === '/icon-192.png' ||
    url.pathname === '/icon-512.png';

  if (!isCacheablePath) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
