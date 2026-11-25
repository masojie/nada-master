// tests/t_sources.mjs - pagar statis untuk src/**/*.js.
//
// build.mjs adalah bundler buatan sendiri yang membaca modul BARIS DEMI BARIS. Dia hanya paham bentuk
// import dan export tertentu, dan kalau menemui bentuk lain dia tidak error: hasilnya bundel yang salah
// atau nama yang diam-diam undefined, baru ketahuan di browser. Tes ini menolak bentuk yang tidak
// didukung dan memeriksa bahwa setiap nama yang diimpor benar-benar diekspor oleh modul tujuannya.
//
// Bentuk yang DIDUKUNG:
//   import { a, b } from './x.js';                satu baris, path relatif lengkap dengan .js
//   export function|class|const|let|var nama      satu nama per deklarasi
//   export { a, b };                              satu baris, tanpa "as"
import fs from 'fs';
import path from 'path';
import { suite } from './lib/harness.mjs';
import { ROOT } from './lib/build.mjs';

const t = suite('sources');
const SRC = path.join(ROOT, 'src');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
const files = walk(SRC).sort();
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const stripComment = (s) => s.replace(/\s\/\/.*$/, '');

const IMPORT_OK = /^import\s*\{([^}]*)\}\s*from\s*(['"])(\.{1,2}\/[^'"]+)\2\s*;?$/;
const EXPORT_DECL = /^export\s+(async\s+function\*?|function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/;

const problems = [], graph = new Map(), exportsOf = new Map(), importsOf = new Map();
t.ok('ada file sumber untuk diperiksa', files.length >= 20, files.length + ' file');

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n'), name = rel(file), exp = new Set(), imps = [], deps = [];
  lines.forEach((raw, idx) => {
    const line = stripComment(raw.trim()), at = name + ':' + (idx + 1);
    if (/<\/script/i.test(raw)) problems.push(at + ' berisi "</script" (merusak tag script di index.html)');
    if (/\bimport\.meta\b/.test(line)) problems.push(at + ' memakai import.meta (tidak didukung bundel non-module)');
    if (/(^|[^\w$.])import\s*\(/.test(line)) problems.push(at + ' memakai import() dinamis (tidak didukung bundler)');
    if (line.startsWith('import ') || line.startsWith('import{')) {
      const m = IMPORT_OK.exec(line);
      if (!m) { problems.push(at + ' bentuk import tidak didukung bundler: ' + line.slice(0, 70)); return; }
      const dep = path.resolve(path.dirname(file), m[3]);
      if (!fs.existsSync(dep)) { problems.push(at + ' import menunjuk file yang tidak ada: ' + m[3]); return; }
      deps.push(dep);
      for (const n of m[1].split(',').map((x) => x.trim()).filter(Boolean)) imps.push({ at, dep, name: n.split(/\s+as\s+/)[0].trim() });
    } else if (line.startsWith('export ') || line.startsWith('export{')) {
      const r = line.slice(6).trimStart();
      if (r.startsWith('{')) {
        if (!r.includes('}')) { problems.push(at + ' export { ... } harus selesai di baris yang sama'); return; }
        if (/\}\s*from\b/.test(r)) { problems.push(at + ' export { ... } from tidak didukung bundler'); return; }
        for (const n of r.slice(1, r.indexOf('}')).split(',').map((x) => x.trim()).filter(Boolean)) {
          if (/\sas\s/.test(n)) problems.push(at + ' "export { x as y }" tidak didukung bundler: ' + n);
          else exp.add(n);
        }
      } else {
        const m = EXPORT_DECL.exec(line);
        if (!m) { problems.push(at + ' bentuk export tidak didukung bundler: ' + line.slice(0, 70)); return; }
        exp.add(m[2]);
        if (/^export\s+(const|let|var)\s+[A-Za-z_$][\w$]*\s*(=[^;]*)?,\s*[A-Za-z_$][\w$]*\s*=/.test(line) && !/[(\[{]/.test(line.slice(0, line.indexOf(','))))
          problems.push(at + ' beberapa deklarasi dalam satu export (hanya nama pertama yang diekspor bundler): ' + line.slice(0, 70));
      }
    }
  });
  exportsOf.set(file, exp); importsOf.set(file, imps); graph.set(file, deps);
}

t.ok('semua file memakai bentuk import/export yang didukung bundler', problems.length === 0, problems.length + ' masalah');
problems.forEach((p) => t.ok(p, false));

// Nama yang diimpor harus ada di ekspor modul tujuan.
let missing = 0;
for (const [file, imps] of importsOf) {
  for (const i of imps) {
    if (!exportsOf.has(i.dep)) continue;
    if (!exportsOf.get(i.dep).has(i.name)) { missing++; t.ok(i.at + ': "' + i.name + '" tidak diekspor oleh ' + rel(i.dep), false); }
  }
}
t.ok('setiap nama yang diimpor benar-benar diekspor', missing === 0, missing + ' hilang');

// Impor melingkar membuat nilai undefined pada saat modul dimuat (bundler memakai cache sederhana).
{
  const state = new Map(), stack = [];
  let cycle = null;
  const dfs = (f) => {
    state.set(f, 1); stack.push(f);
    for (const d of graph.get(f) || []) {
      if (state.get(d) === 1) { cycle = stack.slice(stack.indexOf(d)).concat(d).map(rel).join(' -> '); return; }
      if (!state.get(d)) dfs(d);
      if (cycle) return;
    }
    stack.pop(); state.set(f, 2);
  };
  for (const f of graph.keys()) { if (!state.get(f)) dfs(f); if (cycle) break; }
  t.ok('tidak ada impor melingkar', !cycle, cycle || '');
}

// Privasi: kode tidak boleh punya jalur jaringan. Audio pengguna diproses lokal saja.
{
  const FORBIDDEN = [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bsendBeacon\b/, /\bEventSource\b/, /\bimportScripts\b/, /https?:\/\//];
  const hits = [];
  for (const file of [...files, path.join(SRC, 'ui/index.html')]) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((raw, idx) => {
      const line = raw.replace(/\/\/.*$/, '');
      // satu-satunya pengecualian: service worker (src/pwa/sw.js) memakai fetch hanya untuk berkas aplikasi sendiri (satu origin, dijaga di t_pwa)
      for (const re of FORBIDDEN) { if (re.source === '\\bfetch\\s*\\(' && rel(file) === 'src/pwa/sw.js') continue; if (re.test(line)) hits.push(rel(file) + ':' + (idx + 1) + ' ' + re.source); }
    });
  }
  t.ok('tidak ada pemanggilan jaringan di sumber (audio diproses lokal)', hits.length === 0, hits.slice(0, 5).join(' | '));
}

t.done();
