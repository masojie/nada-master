// tests/t_pwa.mjs - aplikasi bisa dipasang (PWA) dan memperbarui dirinya otomatis
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import zlib from 'zlib';
import { suite } from './lib/harness.mjs';
import { buildDist, DIST, ROOT } from './lib/build.mjs';

const t = suite('pwa');
const r = t.attempt('build.mjs selesai tanpa error', buildDist);
if (!r) t.done();
const html = r.html, rd = (f) => fs.readFileSync(path.join(DIST, f));

t.section('manifest');
const m = JSON.parse(rd('manifest.webmanifest').toString('utf8'));
t.ok('nama, nama pendek, start_url, scope terisi', !!(m.name && m.short_name && m.start_url && m.scope));
t.ok('display standalone (tampil seperti aplikasi)', m.display === 'standalone');
t.ok('ada warna latar dan tema', /^#[0-9a-f]{6}$/i.test(m.background_color) && /^#[0-9a-f]{6}$/i.test(m.theme_color));
const icon = (sz, purpose) => m.icons.find((i) => i.sizes === sz && i.purpose === purpose);
t.ok('ikon 192 dan 512 (any) serta 512 maskable terdaftar', !!(icon('192x192', 'any') && icon('512x512', 'any') && icon('512x512', 'maskable')));
t.ok('semua ikon di manifest ada di dist/', m.icons.every((i) => fs.existsSync(path.join(DIST, i.src))));

t.section('ikon PNG');
for (const [f, size] of [['icon-180.png', 180], ['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512]]) {
  const b = rd(f), sig = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  let idat = Buffer.alloc(0), o = 8; while (o < b.length) { const len = b.readUInt32BE(o), ty = b.toString('ascii', o + 4, o + 8); if (ty === 'IDAT') idat = Buffer.concat([idat, b.subarray(o + 8, o + 8 + len)]); o += 12 + len; }
  const raw = zlib.inflateSync(idat);
  t.ok(f + ': PNG valid ' + size + 'x' + size + ', RGBA 8 bit', sig && w === size && h === size && b[24] === 8 && b[25] === 6 && raw.length === (1 + 4 * size) * size);
}
const maskable = rd('icon-maskable-512.png');
t.ok('ikon maskable memakai latar penuh (tanpa sudut transparan)', (() => { const raw = zlib.inflateSync(maskable.subarray(maskable.indexOf('IDAT') + 4, maskable.indexOf('IEND') - 8)); return raw[1 + 3] === 255; })());

t.section('index.html');
t.ok('tautan manifest, ikon, apple-touch-icon, theme-color ada', ['rel=manifest href=manifest.webmanifest', 'rel=apple-touch-icon', 'name=theme-color', 'rel=icon'].every((s) => html.includes(s)));
t.ok('skrip pwa-boot terpasang dan lolos parse', (() => { const mm = html.match(/<script id=pwa-boot>([\s\S]*?)<\/script>/); try { new vm.Script(mm[1]); return true; } catch { return false; } })());

t.section('service worker');
const swSrc = rd('sw.js').toString('utf8');
t.ok('sw.js lolos parse dan BUILD_ID terisi (bukan placeholder)', (() => { try { new vm.Script(swSrc); } catch { return false; } return !swSrc.includes('__BUILD_ID__') && /const BUILD = '[0-9a-f]{12}'/.test(swSrc); })());
t.ok('semua berkas pra-cache ada di dist/', [...swSrc.matchAll(/PRECACHE = \[([^\]]*)\]/g)][0][1].split(',').map((x) => x.trim().replace(/'/g, '')).every((f) => f === './' || fs.existsSync(path.join(DIST, f))));
{ // jalankan sw.js dengan lingkungan tiruan
  const listeners = {}, store = new Map(), deleted = [];
  const mkCache = (name) => ({ match: async (k) => store.get(name + '|' + (k.url ? new URL(k.url).pathname : k)), put: async (k, v) => store.set(name + '|' + (k.url ? new URL(k.url).pathname : k), v), addAll: async () => {} });
  const self = { location: { origin: 'https://x.test' }, addEventListener: (n, f) => { listeners[n] = f; }, skipWaiting: () => { self._skip = true; }, clients: { claim: async () => { self._claimed = true; } } };
  const caches = { open: async (n) => mkCache(n), keys: async () => ['nada-lama1', 'nada-lama2', 'nada-' + swSrc.match(/const BUILD = '([0-9a-f]{12})'/)[1], 'milik-orang-lain'], delete: async (k) => { deleted.push(k); return true; } };
  vm.runInNewContext(swSrc, { self, caches, URL, Request: class { constructor(u) { this.url = u; } }, fetch: async () => ({ ok: true, clone() { return this; } }), Promise, setTimeout });
  t.ok('sw.js: tanpa XHR/WebSocket/sendBeacon/importScripts dan tanpa alamat http(s)', !/\b(XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts)\b|https?:\/\//.test(swSrc.replace(/\/\/.*$/gm, '')));
t.ok('sw.js: handler fetch berhenti lebih dulu untuk permintaan lintas origin sebelum memanggil fetch', swSrc.indexOf('url.origin !== self.location.origin') > 0 && swSrc.indexOf('url.origin !== self.location.origin') < swSrc.indexOf('fetch(req'));
  t.ok('mendaftarkan install, activate, fetch, message', ['install', 'activate', 'fetch', 'message'].every((k) => typeof listeners[k] === 'function'));
  let waited; listeners.install({ waitUntil: (p) => { waited = p; } }); await waited; t.ok('install: langsung skipWaiting (versi baru aktif tanpa menunggu tab ditutup)', self._skip === true);
  listeners.activate({ waitUntil: (p) => { waited = p; } }); await waited;
  t.ok('activate: hapus cache nada-* versi lama saja, lalu clients.claim', deleted.sort().join() === 'nada-lama1,nada-lama2' && self._claimed === true, 'dihapus=' + deleted.join());
  let responded = false; listeners.fetch({ request: { method: 'POST', url: 'https://x.test/a', mode: 'cors' }, respondWith: () => { responded = true; } });
  listeners.fetch({ request: { method: 'GET', url: 'https://lain.test/a', mode: 'cors' }, respondWith: () => { responded = true; } });
  t.ok('fetch: abaikan POST dan permintaan lintas origin', responded === false);
}
t.ok('build ulang tanpa perubahan memberi BUILD_ID yang sama (deterministik)', (() => { const a = swSrc.match(/const BUILD = '([0-9a-f]{12})'/)[1]; buildDist(); return fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8').includes(a); })());
t.ok('BUILD_ID berubah bila isi aplikasi berubah (pemicu pembaruan otomatis)', (() => { const f = path.join(ROOT, 'src/ui/styles.css'), orig = fs.readFileSync(f, 'utf8'); try { fs.writeFileSync(f, orig + '\n/* t_pwa */\n'); buildDist(); return !fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8').includes(swSrc.match(/const BUILD = '([0-9a-f]{12})'/)[1]); } finally { fs.writeFileSync(f, orig); buildDist(); } })());

t.section('pembaruan otomatis (boot.js)');
const bootSrc = fs.readFileSync(path.join(ROOT, 'src/pwa/boot.js'), 'utf8');
function runBoot({ busy = false, time = '0:00.0 / 0:00.0', protocol = 'https:', hasController = true }) {
  const ev = {}, st = { reloaded: 0, banners: 0, registered: null, waiting: null };
  const body = { classList: { contains: (c) => c === 'busy' && busy }, appendChild: () => { st.banners++; } };
  const mkEl = () => ({ style: {}, setAttribute() {}, append() {}, set textContent(v) {} });
  const sw = { controller: hasController ? {} : null, addEventListener: (n, f) => { ev[n] = f; }, register: (u) => { st.registered = u; return Promise.resolve({ update: () => Promise.resolve(), waiting: null }); } };
  const ctx = { navigator: { serviceWorker: sw }, location: { protocol, reload: () => { st.reloaded++; } }, document: { body, createElement: mkEl, getElementById: (id) => (id === 'time' ? { textContent: time } : null), addEventListener() {}, visibilityState: 'visible' }, window: { addEventListener() {} }, setInterval() {} };
  vm.runInNewContext(bootSrc, ctx); st.fire = () => ev.controllerchange && ev.controllerchange(); return st;
}
{ const s = runBoot({}); t.ok('mendaftarkan sw.js', s.registered === 'sw.js'); }
{ const s = runBoot({}); s.fire(); t.ok('belum ada lagu dan tidak sibuk: halaman langsung dimuat ulang', s.reloaded === 1 && s.banners === 0); s.fire(); t.ok('tidak memuat ulang dua kali', s.reloaded === 1); }
{ const s = runBoot({ time: '0:42.0 / 4:01.2' }); s.fire(); t.ok('lagu sudah dimuat: tidak memuat ulang, tampilkan spanduk Perbarui', s.reloaded === 0 && s.banners === 1); }
{ const s = runBoot({ busy: true }); s.fire(); t.ok('sedang memproses: tidak memuat ulang, tampilkan spanduk', s.reloaded === 0 && s.banners === 1); }
{ const s = runBoot({ hasController: false }); s.fire(); t.ok('pemasangan pertama (belum ada controller): tidak memuat ulang', s.reloaded === 0 && s.banners === 0); }
{ const s = runBoot({ protocol: 'file:' }); t.ok('di luar http(s) tidak mendaftar apa pun', s.registered === null); }
t.ok('boot.js tidak memakai fetch/XHR dan tidak menyentuh variabel aplikasi', !/\b(fetch|XMLHttpRequest)\b/.test(bootSrc) && !/\bS\.(an|man|playing)\b/.test(bootSrc));

t.section('vercel.json');
const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')), hdr = (src) => (vj.headers.find((h) => h.source === src) || { headers: [] }).headers;
t.ok('sw.js tidak di-cache oleh CDN (must-revalidate)', hdr('/sw.js').some((h) => h.key === 'Cache-Control' && /max-age=0/.test(h.value) && /must-revalidate/.test(h.value)));
t.ok('manifest dilayani sebagai application/manifest+json', hdr('/manifest.webmanifest').some((h) => h.key === 'Content-Type' && h.value === 'application/manifest+json'));
t.ok('halaman utama selalu divalidasi ulang (versi baru langsung terbaca)', vj.headers.some((h) => /index/.test(h.source) && h.headers.some((x) => x.key === 'Cache-Control' && /must-revalidate/.test(x.value))));
t.ok('CSP bawaan tetap utuh dan tidak melarang service worker', (() => { const csp = (hdr('/(.*)').find((h) => h.key === 'Content-Security-Policy') || {}).value || ''; return csp.includes("object-src 'none'") && !/worker-src|default-src|script-src|manifest-src|img-src/.test(csp); })());
t.done();
