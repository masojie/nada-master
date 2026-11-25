// sw.js - service worker Nada Master. Konstanta BUILD diisi build.mjs (hash isi build), jadi setiap deploy baru
// menghasilkan sw.js yang berbeda: browser mengenali versi baru, mengaktifkannya langsung (skipWaiting + claim)
// dan halaman memuat ulang dirinya (lihat boot.js).
const BUILD = '__BUILD_ID__';
const CACHE = 'nada-' + BUILD;
const PRECACHE = ['./', 'index.html', 'engine-worker.js', 'preview-worklet.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('nada-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // halaman utama: jaringan dulu (selalu versi terbaru), cadangan dari cache bila offline atau jaringan lambat
    e.respondWith((async () => {
      const cache = await caches.open(CACHE), cached = () => cache.match('index.html');
      const net = fetch(req, { cache: 'no-cache' }).then((res) => { if (res.ok) cache.put('index.html', res.clone()); return res; });
      const have = await cached();
      if (!have) return net;
      return Promise.race([net.catch(() => have), new Promise((r) => setTimeout(() => r(have), NAV_TIMEOUT_MS))]);
    })());
    return;
  }
  // aset lain (worker, ikon, manifest): cache dulu, isi dari jaringan bila belum ada
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then((ca) => ca.put(req, c)); } return res; })));
});
