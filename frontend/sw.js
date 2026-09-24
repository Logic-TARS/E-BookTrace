/**
 * Marginalia Service Worker
 * Network-first for app shell HTML/JS/CSS; cache-first for stable EPUB files;
 * network-only for API calls (503 when offline); cache-first for other static assets.
 */
const APP_SHELL_CACHE_NAME = 'marginalia-shell-v44';
const EPUB_CACHE_NAME = 'marginalia-epubs-v1';

const APP_SHELL = [
  '.',
  'index.html',
  'app.js?v=41',
  'style.css?v=44',
  'manifest.json',
  'jszip.min.js',
  'epub.min.js',
  'book-chat/index.html',
  'book-chat/app.js?v=4',
  'book-chat/style.css?v=3',
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== APP_SHELL_CACHE_NAME && key !== EPUB_CACHE_NAME && !key.startsWith('marginalia-epubs-'))
        .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function cacheFirst(request, cacheName = APP_SHELL_CACHE_NAME) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;

    return fetch(request).then((response) => {
      if (request.method === 'GET' && response.status === 200) {
        const clone = response.clone();
        caches.open(cacheName).then((cache) => {
          cache.put(request, clone);
        });
      }
      return response;
    });
  });
}

function networkFirst(request) {
  return fetch(request).then((response) => {
    if (request.method === 'GET' && response.status === 200) {
      const clone = response.clone();
      caches.open(APP_SHELL_CACHE_NAME).then((cache) => cache.put(request, clone));
    }
    return response;
  }).catch(() => caches.match(request));
}

// Fetch: cache-first for app shell/books, network-only direct fetch/503 for API data
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Server-side EPUB files are static and expensive over remote links.
  if (
    event.request.method === 'GET' &&
    url.pathname.startsWith('/api/books/') &&
    (url.pathname.endsWith('/file') || url.pathname.toLowerCase().endsWith('.epub'))
  ) {
    event.respondWith(cacheFirst(event.request, EPUB_CACHE_NAME));
    return;
  }

  // API calls: network-only; failures return 503 JSON (don't cache)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
    return;
  }

  // Prefer fresh application code online so remote devices do not remain on
  // an old import flow after a deployment.
  if (
    event.request.mode === 'navigate' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/app.js') ||
    url.pathname.endsWith('/style.css')
  ) {
    const fallback = url.pathname.startsWith('/book-chat/') && event.request.mode === 'navigate'
      ? 'book-chat/index.html'
      : 'index.html';
    event.respondWith(
      networkFirst(event.request).then((response) => response || caches.match(fallback))
    );
    return;
  }

  // Vendored libraries and other static assets remain cache-first.
  event.respondWith(
    cacheFirst(event.request, APP_SHELL_CACHE_NAME).catch(() => {
        return new Response('Offline', { status: 503 });
    })
  );
});
