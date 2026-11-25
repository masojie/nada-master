// build.mjs - zero-dependency bundler: ES modules -> dist/index.html (single self-contained file, worker inlined) + dist/engine-worker.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { makeIcon } from './src/pwa/icons.mjs';
const ROOT = path.dirname(fileURLToPath(import.meta.url)), NL = String.fromCharCode(10);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const isId = (c) => /[A-Za-z0-9_$]/.test(c);
function ident(s, i) { let j = i; while (j < s.length && isId(s[j])) j++; return s.slice(i, j); }
function bundle(entry) {
  const mods = new Map();
  const load = (abs) => {
    if (mods.has(abs)) return;
    mods.set(abs, '');
    const deps = [], exported = [];
    const lines = fs.readFileSync(abs, 'utf8').split(NL).map((line) => {
      const t = line.trim();
      if (t.startsWith('import ') || t.startsWith('import{')) {
        const a = t.indexOf('{'), b = t.indexOf('}'), fi = t.indexOf('from', b);
        let q = fi + 4; while (t[q] === ' ') q++;
        const q2 = t.indexOf(t[q], q + 1), dep = path.resolve(path.dirname(abs), t.slice(q + 1, q2)); deps.push(dep);
        const names = t.slice(a + 1, b).split(',').map((n) => n.trim()).filter(Boolean).map((n) => n.split(' as ').map((x) => x.trim()).join(': '));
        return 'const { ' + names.join(', ') + ' } = __req(' + JSON.stringify(rel(dep)) + ');';
      }
      if (t.startsWith('export ')) {
        const r = t.slice(7).trimStart();
        if (r.startsWith('{')) { r.slice(1, r.indexOf('}')).split(',').map((n) => n.trim()).filter(Boolean).forEach((n) => exported.push(n)); return ''; }
        const kw = ['async function* ', 'async function ', 'function* ', 'function ', 'class ', 'const ', 'let ', 'var '].find((k) => r.startsWith(k));
        if (kw) { exported.push(ident(r, kw.length)); return line.replace('export ', ''); }
      }
      return line;
    });
    mods.set(abs, lines.join(NL) + NL + exported.map((n) => '__exports.' + n + ' = ' + n + ';').join(NL) + NL);
    deps.forEach(load);
  };
  const e = path.resolve(ROOT, entry); load(e);
  let out = '(function(){' + NL + 'const __defs = {}, __cache = {};' + NL + 'function __req(id){ if (__cache[id]) return __cache[id]; const e = (__cache[id] = {}); __defs[id](e); return e; }' + NL;
  for (const [abs, src] of mods) out += '__defs[' + JSON.stringify(rel(abs)) + '] = function(__exports){' + NL + src + NL + '};' + NL;
  return out + '__req(' + JSON.stringify(rel(e)) + ');' + NL + '})();' + NL;
}
const worker = bundle('src/worker.js'), worklet = bundle('src/preview/preview-worklet.js'), app = bundle('src/ui/app.js');
for (const [n, s] of [['worker', worker], ['worklet', worklet], ['app', app]]) if (s.toLowerCase().includes('</script')) throw new Error(n + ' bundle contains a closing script tag');
// fonts: url(fonts/x.woff2) in styles.css is embedded as a data: URI so dist/index.html stays one self-contained file (no CDN, no request)
const css = fs.readFileSync(path.join(ROOT, 'src/ui/styles.css'), 'utf8').replace(/url\(fonts\/([A-Za-z0-9_.-]+\.woff2)\)/g, (m, f) => 'url(data:font/woff2;base64,' + fs.readFileSync(path.join(ROOT, 'src/ui/fonts', f)).toString('base64') + ')');
let html = fs.readFileSync(path.join(ROOT, 'src/ui/index.html'), 'utf8');
html = html.replace('<!--CSS-->', () => '<style>' + NL + css + NL + '</style>')
  .replace('<!--WORKER-->', () => '<script id=worker-src type=text/plain>' + worker + '</script>')
  .replace('<!--APP-->', () => '<script>' + app + '</script>');
// ---- PWA: manifest, ikon, service worker, dan skrip pembaruan otomatis ----
// BUILD_ID = hash isi build: tiap deploy yang isinya berubah menghasilkan sw.js yang berbeda, sehingga browser
// mengenali versi baru dan aplikasi yang sudah terpasang memperbarui dirinya sendiri.
const pwa = (n) => fs.readFileSync(path.join(ROOT, 'src/pwa', n), 'utf8');
const manifest = pwa('manifest.webmanifest'), swTpl = pwa('sw.js'), boot = pwa('boot.js');
if (boot.toLowerCase().includes('</script')) throw new Error('boot.js contains a closing script tag');
html = html.replace('</head>', () => [
  '<link rel=manifest href=manifest.webmanifest>',
  '<link rel=icon type=image/png sizes=192x192 href=icon-192.png>',
  '<link rel=apple-touch-icon href=icon-180.png>',
  '<meta name=theme-color content=#17171A>',
  '<meta name=mobile-web-app-capable content=yes>',
  '<meta name=apple-mobile-web-app-capable content=yes>',
  '<meta name=apple-mobile-web-app-title content="Nada Master">',
].join(NL) + NL + '</head>').replace('</body>', () => '<script id=pwa-boot>' + boot + '</script>' + NL + '</body>');
// ---- CSP ketat: skrip inline hanya jalan bila hash SHA-256-nya cocok (dihitung dari isi build ini) ----
// Tanpa 'unsafe-inline' / 'unsafe-eval' di script-src, tanpa blob: dan data:, dan tanpa host luar. Blok <script type=text/plain>
// (teks worker) bukan skrip yang dieksekusi, jadi tidak perlu hash. frame-ancestors tidak bisa lewat <meta>, tetap di vercel.json.
const execScripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/type=text\/plain/.test(m[1]));
const hashes = execScripts.map((m) => "'sha256-" + crypto.createHash('sha256').update(m[2]).digest('base64') + "'");
const csp = ["default-src 'none'", "script-src 'self' " + hashes.join(' '), "worker-src 'self' blob:", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:", "media-src 'self' blob: data:", "manifest-src 'self'", "connect-src 'self' blob: data:", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');
html = html.replace('<meta charset=utf-8>', (m) => m + NL + '<meta http-equiv=Content-Security-Policy content="' + csp + '">');
const buildId = crypto.createHash('sha256').update(html).update(worker).update(manifest).update(swTpl).digest('hex').slice(0, 12);
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/sw.js'), swTpl.split('__BUILD_ID__').join(buildId));
fs.writeFileSync(path.join(ROOT, 'dist/manifest.webmanifest'), manifest);
for (const [file, size, maskable] of [['icon-180.png', 180, true], ['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true]]) fs.writeFileSync(path.join(ROOT, 'dist', file), makeIcon(size, maskable));
fs.writeFileSync(path.join(ROOT, 'dist/index.html'), html);
fs.writeFileSync(path.join(ROOT, 'dist/engine-worker.js'), worker);
fs.writeFileSync(path.join(ROOT, 'dist/preview-worklet.js'), worklet);
console.log('dist/index.html ' + Math.round(html.length / 1024) + ' KB (worker ' + Math.round(worker.length / 1024) + ' KB, app ' + Math.round(app.length / 1024) + ' KB), PWA ' + buildId);
