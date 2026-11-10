/* MyBusinessHub offline shell — local assets first, API never cached */
const CACHE = 'bh-offline-v8';
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

async function fillCache() {
  const c = await caches.open(CACHE);
  for (const url of PRECACHE) {
    try {
      if (await c.match(url)) continue;
      const res = await fetch(url, { cache: 'reload' });
      if (res && res.ok) await c.put(url, res);
    } catch (err) { /* retry later */ }
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(fillCache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim()).then(() => fillCache())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'ensure-cache' || (e.data && e.data.type === 'ensure-cache')) {
    e.waitUntil(fillCache());
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  // Never intercept API — network only
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    return;
  }

  if (url.origin === self.location.origin) {
    const isDoc = req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')
      || url.pathname === '/marketplace' || url.pathname.startsWith('/store') || url.pathname.startsWith('/search');
    if (isDoc) {
      e.respondWith(
        fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => {
                c.put(req, copy);
                c.put('/index.html', res.clone()).catch(() => {});
              });
            }
            return res;
          })
          .catch(() =>
            caches.match('/index.html')
              .then((m) => m || caches.match('/') || caches.match(req))
              .then((m) => m || new Response('Offline — open the app once online to cache the shell.', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
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
  }
});
