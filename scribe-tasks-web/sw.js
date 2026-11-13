/* Scribe Tasks – Service Worker
 * - App-Shell wird beim Installieren vollständig vorgeladen (offline nutzbar).
 * - Seitenaufrufe: zuerst Netz, offline aus dem Cache.
 * - Statische Dateien: aus dem Cache, im Hintergrund aktualisiert.
 * - Fremde Hosts (Google, Microsoft) werden nie angefasst oder gecacht.
 * Liste und Version kommen aus precache-manifest.js (npm run precache).
 */
importScripts('./precache-manifest.js');

const CACHE = `scribe-tasks-${self.PRECACHE_VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(self.PRECACHE_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('scribe-tasks-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // OAuth-Antworten kommen als #hash zurück – der Hash erreicht den SW nicht,
    // die App-Seite kann also gefahrlos aus dem Cache kommen.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            // Jede Seite unter ihrer eigenen Adresse cachen (nicht alles als index.html)
            const copy = response.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request, { ignoreSearch: true }))
          || caches.match('./index.html', { ignoreSearch: true })),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      if (cached) {
        event.waitUntil(network.catch(() => {}));
        return cached;
      }
      return network;
    }),
  );
});
