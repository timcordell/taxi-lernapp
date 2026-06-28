const CACHE_NAME = 'taxiprofi-v2';
const ASSETS = [
  '/taxi-lernapp/taxi_lernapp.html',
  '/taxi-lernapp/manifest.json',
  '/taxi-lernapp/icons/icon-192.png',
  '/taxi-lernapp/icons/icon-512.png'
];

// Install: Assets vorab laden
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: alten Cache sofort löschen, neuen SW übernehmen
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: Network-first für HTML (immer aktuell), Cache-first für Icons/Manifest
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isHtml = url.pathname.endsWith('.html');

  if (isHtml) {
    // Network-first: frische Version vom Server, Fallback auf Cache
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const toCache = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Cache-first für statische Assets (Icons, Manifest)
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const toCache = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
          }
          return response;
        });
      })
    );
  }
});
