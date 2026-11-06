/* MyBusinessHub offline shell — local assets first, API never cached */
const CACHE = 'bh-offline-v4';
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/manifest.json',
  '/sw.js',
  '/vendor/tailwindcdn.js',
  '/vendor/chart.umd.min.js',
  '/logo.jpg',
  '/logo.png',
  '/logo-mark.png',
  '/logo-mark.jpg',
  '/app-icon.png',
  '/icon-192.png',
  '/icon-256.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/favicon.png',
  '/favicon-16.png',
  '/favicon-32.png',
  '/favicon-48.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      for (const url of PRECACHE) {
        try { await c.add(url); } catch (err) { /* optional asset */ }
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache API — network only (fail offline for API)
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    return;
  }

  // Same-origin static: cache-first for vendor/icons, network-first for HTML
  if (url.origin === self.location.origin) {
    const isDoc = req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');
    if (isDoc) {
      e.respondWith(
        fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() =>
            caches.match(req).then((m) => m || caches.match('/index.html') || caches.match('/'))
          )
      );
      return;
    }
    e.respondWith(
      caches.match(req).then((cached) => {
        const net = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  // Optional CDN fallbacks (if local vendor missing)
  if (
    url.hostname === 'cdn.tailwindcss.com' ||
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    e.respondWith(
      caches.match(req).then((m) => {
        return (
          m ||
          fetch(req)
            .then((res) => {
              if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
              return res;
            })
            .catch(() => m || Response.error())
        );
      })
    );
  }
});
