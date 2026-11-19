// tests/run-all.mjs - menjalankan semua tests/t_*.mjs satu per satu dan memberi ringkasan.
//
// Pemakaian:
//   npm test                       semua tes
//   npm run test:fast              lewati tes yang ditandai "// @slow" di 5 baris pertama
//   node tests/run-all.mjs chain   hanya file yang namanya memuat "chain" (boleh beberapa kata)
//   node tests/run-all.mjs --verbose   tampilkan seluruh keluaran tiap file
//   node tests/run-all.mjs --list      hanya daftar file tes
//
// Kode keluar 1 bila ada file yang gagal, crash, atau timeout. Baris TODO (bug yang sudah dicatat)
// tidak menggagalkan, tetapi selalu didaftar di akhir supaya tidak terlupa.
// Di GitHub Actions, ringkasan juga ditulis ke $GITHUB_STEP_SUMMARY.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(DIR);
const args = process.argv.slice(2), flag = (f) => args.includes(f), filters = args.filter((a) => !a.startsWith('--'));
const TIMEOUT_MS = 5 * 60 * 1000;

// Tes lama (sebelum ada penanda) yang lambat tetapi belum diberi "// @slow" di file-nya.
const LEGACY_SLOW = new Set(['t_modules', 't_presets']);
const isSlow = (file) => LEGACY_SLOW.has(path.basename(file, '.mjs')) || fs.readFileSync(file, 'utf8').split('\n').slice(0, 5).some((l) => /^\/\/\s*@slow\b/.test(l));
let files = fs.readdirSync(DIR).filter((f) => /^t_.*\.mjs$/.test(f)).sort().map((f) => ({ name: f.replace(/\.mjs$/, ''), file: path.join(DIR, f) }));
files.forEach((f) => { f.slow = isSlow(f.file); });
if (filters.length) files = files.filter((f) => filters.some((x) => f.name.includes(x)));
if (flag('--fast')) files = files.filter((f) => !f.slow);

if (flag('--list')) { files.forEach((f) => console.log(f.name + (f.slow ? '  (slow)' : ''))); process.exit(0); }
if (!files.length) { console.error('Tidak ada file tes yang cocok.'); process.exit(1); }

const fmtS = (ms) => (ms < 60000 ? (ms / 1000).toFixed(1) + 's' : Math.floor(ms / 60000) + 'm ' + Math.round((ms % 60000) / 1000) + 's');
const pad = (s, n) => String(s).padEnd(n);
console.log('NADA Master: ' + files.length + ' file tes, Node ' + process.version + (flag('--fast') ? ', mode cepat' : '') + '\n');

const results = [], t0 = Date.now();
for (const f of files) {
  const s = Date.now(), r = spawnSync(process.execPath, [f.file], { cwd: ROOT, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || ''), lines = out.split('\n');
  const pick = (tag) => lines.filter((l) => l.startsWith(tag + ' '));
  const res = { name: f.name, ms: Date.now() - s, pass: pick('PASS').length, fail: pick('FAIL'), todo: pick('TODO'), code: r.status, signal: r.signal, error: r.error, out, lines };
  res.ok = res.code === 0 && res.fail.length === 0 && !r.error;
  results.push(res);
  const tag = res.ok ? 'OK    ' : 'GAGAL ';
  console.log('  ' + tag + pad(f.name, 16) + pad(res.pass + ' lulus', 11) + pad(res.todo.length ? res.todo.length + ' todo' : '', 9) + pad(res.fail.length ? res.fail.length + ' gagal' : '', 10) + fmtS(res.ms));
  if (flag('--verbose')) console.log(out.replace(/^/gm, '      '));
  if (!res.ok) {
    if (r.error && r.error.code === 'ETIMEDOUT') console.log('      timeout setelah ' + fmtS(TIMEOUT_MS));
    else if (r.error) console.log('      tidak bisa dijalankan: ' + r.error.message);
    res.fail.slice(0, 30).forEach((l) => console.log('      ' + l.slice(0, 220)));
    if (!res.fail.length) lines.filter(Boolean).slice(-15).forEach((l) => console.log('      ' + l.slice(0, 220)));
  }
}

const bad = results.filter((r) => !r.ok), todos = results.flatMap((r) => r.todo.map((l) => ({ file: r.name, text: l.replace(/^TODO /, '') })));
const total = Date.now() - t0, passN = results.reduce((a, r) => a + r.pass, 0);
console.log('\nRingkasan: ' + (results.length - bad.length) + ' file lulus, ' + bad.length + ' gagal, ' + passN + ' pernyataan lulus, ' + todos.length + ' todo, total ' + fmtS(total));
if (todos.length) {
  console.log('\nTODO terbuka (bug yang sudah dicatat dan belum diperbaiki):');
  todos.forEach((x) => console.log('  [' + x.file + '] ' + x.text.slice(0, 200)));
}
console.log(bad.length ? '\nGAGAL: ' + bad.map((r) => r.name).join(', ') : '\nSEMUA LULUS');

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = ['## Hasil tes NADA Master (Node ' + process.version + ')', '', '| File | Lulus | Gagal | Todo | Waktu |', '|---|---:|---:|---:|---:|']
    .concat(results.map((r) => '| ' + (r.ok ? 'OK ' : 'GAGAL ') + r.name + ' | ' + r.pass + ' | ' + r.fail.length + ' | ' + r.todo.length + ' | ' + fmtS(r.ms) + ' |'));
  if (todos.length) md.push('', '### TODO terbuka', '', ...todos.map((x) => '- `' + x.file + '`: ' + x.text.slice(0, 240)));
  if (bad.length) md.push('', '### Pernyataan yang gagal', '', ...bad.flatMap((r) => r.fail.slice(0, 20).map((l) => '- `' + r.name + '`: ' + l.slice(0, 240))));
  try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n'); } catch { /* abaikan */ }
}
process.exit(bad.length ? 1 : 0);
