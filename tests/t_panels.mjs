// tests/t_panels.mjs - Analysis & comparison dan Diagnosis: dua panel penuh yang digeser kanan-kiri (scroll-snap), tab sebagai penanda dan pintasan
import fs from 'fs';
import { suite } from './lib/harness.mjs';

const t = suite('panels');
const read = (f) => fs.readFileSync(new URL('../src/ui/' + f, import.meta.url), 'utf8');
const html = read('index.html'), app = read('app.js'), css = read('styles.css');
const count = (s, re) => (s.match(re) || []).length;
const idOnce = (id) => count(html, new RegExp('id=' + id + '(?![\\w-])', 'g')) === 1;

t.section('struktur: dua kartu, masing-masing dua panel yang digeser');
for (const id of ['cmpg', 'cmpt', 'cmpA', 'cmpB', 'dxg', 'dxt', 'problems', 'actions', 'tDet', 'tAda']) t.ok('id ' + id + ' tepat satu', idOnce(id));
const cmpSec = html.slice(html.indexOf('aria-label="Analysis and comparison"'), html.indexOf('aria-label="Diagnosis"'));
const dxSec = html.slice(html.indexOf('aria-label="Diagnosis"'), html.indexOf('aria-label="Quality control"'));
t.ok('Analysis: cmpA (Loudness) lalu cmpB (Stereo & spectrum) di dalam .swipe', cmpSec.indexOf('class=swipe') > 0 && cmpSec.indexOf('id=cmpA') > cmpSec.indexOf('class=swipe') && cmpSec.indexOf('id=cmpB') > cmpSec.indexOf('id=cmpA'));
t.ok('Diagnosis: Detected dulu, Adaptive sesudahnya, di dalam .swipe', dxSec.indexOf('class=swipe') > 0 && dxSec.indexOf('id=problems') > dxSec.indexOf('class=swipe') && dxSec.indexOf('id=actions') > dxSec.indexOf('id=problems'));
t.ok('tiap kartu punya tepat dua tab', count(cmpSec, /role=tab(?!list)/g) === 2 && count(dxSec, /role=tab(?!list)/g) === 2);

t.section('semua metrik tampil tepat sekali (tidak ada yang hilang saat dibelah)');
const pickA = app.match(/\$\('cmpA'\)\.innerHTML = pick\(\[([\d, ]+)\]\)/), pickB = app.match(/\$\('cmpB'\)\.innerHTML = pick\(\[([\d, ]+)\]\)/);
const ixs = [...(pickA ? pickA[1].split(',') : []), ...(pickB ? pickB[1].split(',') : [])].map((x) => +x.trim()).sort((a, b) => a - b);
const rc = app.indexOf('function renderCompare');
const nRows = count(app.slice(rc, app.indexOf('const cell = ', rc)), /\['[^']+', \(x\) =>/g);
t.ok('jumlah metrik ' + nRows + ' = jumlah indeks di kedua panel', nRows > 0 && ixs.length === nRows);
t.ok('indeks 0..n-1 masing-masing tepat sekali', ixs.every((v, i) => v === i));

t.section('gaya: baris datar, tanpa kartu bentuk folder, tanpa tombol swap');
t.ok('renderProblems/renderActions memakai baris datar (dxRow)', app.includes('const dxRow =') && !app.includes('noteCard') && !/\.nc\b/.test(css) && !/class="nc/.test(app));
t.ok('adjustment memakai nama tahap (stage) sebagai judul', app.includes("dxRow(i, a.stage, esc(a.text)"));
t.ok('tidak ada sisa fitur swap (tombol, handler, penyimpanan)', !/btnSwap|bindSwap|data-swap|lintang-swap/.test(html + app + css));

t.section('geser kanan-kiri benar-benar berfungsi (bukan tampilan palsu)');
t.ok('CSS: scroll-snap horizontal, tiap panel selebar kontainer', /\.swipe\{[^}]*overflow-x:auto[^}]*scroll-snap-type:x mandatory/.test(css) && /\.swipe>\.pane\{flex:0 0 100%[^}]*scroll-snap-align:start/.test(css));
t.ok('bindSwipe dipasang ke kedua kartu', app.includes("bindSwipe('cmpg', 'cmpt')") && app.includes("bindSwipe('dxg', 'dxt')"));
t.ok('tab menggulir ke panelnya (scrollTo) dan penanda mengikuti geseran (scroll -> sync)', app.includes('b.onclick = () => el.scrollTo({ left: k * el.clientWidth') && app.includes("el.addEventListener('scroll', sync"));
t.ok('tab aktif ditandai lewat class on dan aria-selected', app.includes("b.classList.toggle('on', k === i)") && app.includes("b.setAttribute('aria-selected'"));
t.ok('jumlah isu/penyesuaian ditampilkan di tab (panel tersembunyi tetap terlihat isinya)', app.includes("$('tDet').textContent = 'Detected'") && app.includes("$('tAda').textContent = 'Adaptive'"));

t.done();
