const CACHE_NAME = 'littleapi-pwa-v4';
const CORE = [
  '/app.html',
  '/styles.css',
  '/app-enhancements.css',
  '/manifest.webmanifest',
  '/littleapi-icon.svg',
  '/offline.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API traffic must always reach production directly. Never serve API data,
  // auth responses or mutations from the service-worker cache.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/functions/') ||
    url.pathname.startsWith('/auth/')
  ) return;

  // LittleApps is edited frequently. Always fetch its builder/runtime and
  // related scripts from the network instead of reusing an older PWA copy.
  if (
    url.pathname.endsWith('/littleapp.html') ||
    url.pathname.endsWith('/littleapp-v3.html') ||
    url.pathname.endsWith('/app-builder.html') ||
    url.pathname.endsWith('/littleapps-dashboard.js') ||
    url.pathname.endsWith('/config.js')
  ) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match('/offline.html'))
    );
    return;
  }

  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then(response => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
