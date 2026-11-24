// build.mjs - zero-dependency bundler: ES modules -> dist/index.html (single self-contained file, worker inlined) + dist/engine-worker.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
  .replace('<!--WORKLET-->', () => '<script id=worklet-src type=text/plain>' + worklet + '</script>')
  .replace('<!--APP-->', () => '<script>' + app + '</script>');
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/index.html'), html);
fs.writeFileSync(path.join(ROOT, 'dist/engine-worker.js'), worker);
console.log('dist/index.html ' + Math.round(html.length / 1024) + ' KB (worker ' + Math.round(worker.length / 1024) + ' KB, app ' + Math.round(app.length / 1024) + ' KB)');
