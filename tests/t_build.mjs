// tests/t_build.mjs - menjalankan "node build.mjs" (seperti Vercel) lalu memeriksa hasilnya di dist/.
import vm from 'vm';
import { suite } from './lib/harness.mjs';
import { buildDist } from './lib/build.mjs';

const t = suite('build');
const BUDGET_KB = 600;

const r = t.attempt('build.mjs selesai tanpa error', buildDist);
if (!r) t.done();
const { log, html, worker, worklet } = r;

t.section('ukuran dan kelengkapan');
t.ok('build mencetak ringkasan ukuran', /dist\/index\.html \d+ KB/.test(log), log.split('\n').pop());
t.atMost('ukuran index.html di bawah anggaran', html.length / 1024, BUDGET_KB, ' KB');
t.atMost('ukuran engine-worker.js di bawah anggaran', worker.length / 1024, BUDGET_KB, ' KB');
for (const ph of ['<!--CSS-->', '<!--WORKER-->', '<!--APP-->']) t.ok('placeholder ' + ph + ' sudah diganti', !html.includes(ph));
t.ok('ada <style> hasil inline', /<style>[\s\S]+<\/style>/.test(html));
const links = [...html.matchAll(/<link[^>]*>/gi)].map((m) => m[0]);
t.ok('tidak ada <script src=...> eksternal; <link> hanya manifest/ikon PWA satu origin', !/<script[^>]+\bsrc=/i.test(html) && links.every((l) => /rel="?(manifest|icon|apple-touch-icon)\b/i.test(l) && !/href="?(https?:)?\/\//i.test(l)), 'link=' + links.length);

t.section('sintaks JavaScript');
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1].trim(), code: m[2] }));
t.ok('ada tiga script inline (worker teks + aplikasi + pwa-boot); worklet jadi berkas dist/preview-worklet.js', scripts.length === 3, 'jumlah=' + scripts.length);
const workerScript = scripts.find((s) => /worker-src/.test(s.attrs)), appScript = scripts.find((s) => !/worker-src|pwa-boot/.test(s.attrs));
t.ok('tidak ada blok worklet inline lagi (dimuat dari berkas satu origin, supaya script-src tidak butuh blob:)', !/worklet-src/.test(html));
t.ok('preview-worklet.js memuat registerProcessor', /registerProcessor\("lintang-preview"|registerProcessor\('lintang-preview'/.test(worklet));
t.ok('worklet tidak memakai API jaringan', !/\b(fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|importScripts)\b/.test(worklet));
t.ok('worklet lolos parse', (() => { try { new vm.Script(worklet, { filename: 'worklet' }); return true; } catch (e) { return false; } })());
t.ok('script worker-src bertipe text/plain (tidak dieksekusi halaman)', !!workerScript && /text\/plain/.test(workerScript.attrs));
t.ok('isi worker-src identik dengan dist/engine-worker.js', !!workerScript && workerScript.code === worker, 'beda panjang: ' + (workerScript ? workerScript.code.length : 0) + ' vs ' + worker.length);
for (const [name, code] of [['dist/engine-worker.js', worker], ['script aplikasi di index.html', appScript ? appScript.code : '']]) {
  let err = '';
  try { new vm.Script(code, { filename: name }); } catch (e) { err = e.message; }
  t.ok(name + ' lolos parse', code.length > 0 && !err, err);
}

t.section('pagar keamanan bundel');
t.ok('worker tidak memakai API jaringan', !/\b(fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|importScripts)\b/.test(worker));
t.ok('aplikasi tidak memakai API jaringan', !/\b(fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource)\b/.test(appScript ? appScript.code : ''));
t.ok('bundel aplikasi tidak memuat string "</script"', !/<\/script/i.test(appScript ? appScript.code : ''));

t.section('build berulang');
{
  const again = t.attempt('build kedua tanpa error', buildDist);
  if (again) t.ok('build deterministik: hasil identik antar-run', again.html === html && again.worker === worker);
}

t.section('font konsep ditanam (tanpa CDN)');
t.ok('5 font woff2 (Archivo + JetBrains Mono) tertanam sebagai data URI', (html.match(/url\(data:font\/woff2;base64,/g) || []).length === 5);
t.ok('tidak ada alamat font relatif yang tersisa', !/url\(fonts\//.test(html));
t.ok('tidak ada Google Fonts / CDN', !/fonts\.googleapis|fonts\.gstatic|cdn\./i.test(html));
t.done();
