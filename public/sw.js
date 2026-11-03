// BusinessHub service worker: always fetch the newest app when online, fall back to the cached copy offline.
const CACHE = 'bh-shell-v1';
const CDN = ['cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'])).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  const u = new URL(r.url);
  if (r.method !== 'GET') return;
  if (u.origin === location.origin) {
    if (u.pathname.startsWith('/api/')) return; // never cache data
    e.respondWith(
      fetch(r)
        .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); } return res; })
        .catch(() => caches.match(r).then((m) => m || (r.mode === 'navigate' ? caches.match('/') : Response.error())))
    );
  } else if (CDN.includes(u.hostname)) {
    e.respondWith(
      caches.match(r).then((m) => {
        const net = fetch(r).then((res) => { caches.open(CACHE).then((c) => c.put(r, res.clone())); return res; }).catch(() => m);
        return m || net;
      })
    );
  }
});
