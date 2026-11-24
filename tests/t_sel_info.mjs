// tests/t_sel_info.mjs - penjelasan di pop-up pilihan: lengkap untuk semua opsi dan cocok dengan perilaku mesin
import fs from 'fs';
import { suite } from './lib/harness.mjs';
import { selAbout, selOptionDesc } from '../src/ui/sel-info.js';
import { GENRES, CATEGORIES, VOICINGS, LOUDNESS_TARGETS, modeTarget } from '../src/engine/settings.js';
import { resolveDither } from '../src/engine/dither.js';
import { tpFactorFor } from '../src/engine/oversample.js';

const t = suite('sel-info');
const src = (f) => fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
const html = src('ui/index.html'), app = src('ui/app.js'), css = src('ui/styles.css'), info = src('ui/sel-info.js');

// opsi: yang ditulis statis di HTML + yang diisi app.js dari data mesin
const opts = {};
for (const m of html.matchAll(/<select class=sel id=(\w+)[^>]*>([\s\S]*?)<\/select>/g)) {
  opts[m[1]] = [...m[2].matchAll(/<option(?: value=([^>]+))?>([^<]*)<\/option>/g)].map((o) => (o[1] != null ? o[1] : o[2]));
}
opts.cat = CATEGORIES.map((_, i) => String(i));
opts.voicing = Object.keys(VOICINGS);
opts.loud = LOUDNESS_TARGETS.map((x) => x.id);
const ids = [...html.matchAll(/<select class=sel id=(\w+)/g)].map((m) => m[1]);

t.section('setiap pop-up punya catatan bawah dan setiap opsi punya penjelasan');
t.ok('ada 7 pop-up pilihan', ids.length === 7);
for (const id of ids) {
  t.ok(id + ': catatan bawah tidak kosong', selAbout(id).length >= 40);
  t.ok(id + ': ' + (opts[id] || []).length + ' opsi semuanya berpenjelasan', (opts[id] || []).length > 0 && opts[id].every((v) => selOptionDesc(id, v).length >= 12));
}
t.ok('id tak dikenal tidak menghasilkan teks', selAbout('xx') === '' && selOptionDesc('xx', '1') === '' && selOptionDesc('sr', 'tidak-ada') === '');

t.section('klaim penjelasan cocok dengan mesin');
t.ok('dither Auto: 16-bit 44,1/48 kHz noise-shaped, selain itu TPDF, 32-bit tanpa dither', resolveDither('auto', 16, 44100) === 'shaped' && resolveDither('auto', 16, 48000) === 'shaped' && resolveDither('auto', 16, 96000) === 'tpdf' && resolveDither('auto', 24, 44100) === 'tpdf' && resolveDither('auto', 32, 48000) === 'none');
t.ok('dither Noise-shaped di luar 16-bit 44,1/48 kHz jatuh ke TPDF', resolveDither('shaped', 24, 48000) === 'tpdf' && resolveDither('shaped', 16, 96000) === 'tpdf' && resolveDither('none', 16, 44100) === 'none' && resolveDither('tpdf', 16, 44100) === 'tpdf');
t.ok('true peak: interpolasi 4x di bawah 120 kHz, 2x di atasnya', tpFactorFor(44100) === 4 && tpFactorFor(96000) === 4 && tpFactorFor(192000) === 2 && /4×/.test(selAbout('ceil')) && /2×/.test(selAbout('ceil')) && /120 kHz/.test(selAbout('ceil')));
t.ok('resampler memakai redaman bawaan 95 dB (sama dengan teks)', src('engine/resample.js').includes('atten = 95') && /95 dB/.test(selAbout('sr')));
t.ok('export resample dikawal limiter pengaman sebesar ceiling', /if \(outFs !== fs\) \{ data = resample\(/.test(src('engine/exporter.js')) && src('engine/exporter.js').includes('ceilingDb: ceil') && /limiter pengaman true-peak/.test(selAbout('sr')));
t.ok('export diverifikasi bit-exact dengan decode ulang', src('engine/exporter.js').includes("'Decoded back & compared'") && /bit-exact/.test(selAbout('fmt')));
t.ok('sample rate di HTML sama dengan yang dijelaskan (Original + 4 angka)', JSON.stringify(opts.sr) === JSON.stringify(['0', '44100', '48000', '88200', '96000']));
t.ok('rumus target Auto: Transparent maks -14, Warm -0,5, Modern tetap, Loud +1,5 (maks -7,5), Dynamic -3 (-14..-18)', modeTarget('transparent', -9) === -14 && modeTarget('warm', -9) === -9.5 && modeTarget('modern', -9) === -9 && modeTarget('loud', -12) === -10.5 && modeTarget('loud', -6) === -7.5 && modeTarget('dynamic', -12) === -15 && modeTarget('dynamic', -20) === -18 && modeTarget('dynamic', -9) === -14);
const lufs = (id) => LOUDNESS_TARGETS.find((x) => x.id === id).lufs;
t.ok('Spotify dan YouTube sama (-14), Apple dan Dynamic sama (-16), Apple lebih pelan dari Spotify', lufs('spotify') === -14 && lufs('youtube') === -14 && lufs('apple') === -16 && lufs('dynamic') === -16 && lufs('commercial') === -9.5 && /sama dengan Spotify/.test(selOptionDesc('loud', 'youtube')) && /setara Apple/.test(selOptionDesc('loud', 'dynamic')));
t.ok('kolom Custom target dibatasi -30 sampai -6 LUFS', /id=custom[^>]*min=-30 max=-6/.test(html) && /−30 sampai −6/.test(selOptionDesc('loud', 'custom')));
t.ok('batas limiting gaya mastering 1,5 sampai 6 LU', /loud\.maxLimitLu = 1\.5/.test(src('engine/settings.js')) && /loud\.maxLimitLu = 6;/.test(src('engine/settings.js')) && /1,5 sampai 6 LU/.test(selAbout('loud')));
t.ok('ceiling bawaan mesin -1 dBTP', /lim: \{ bypass: false, ceilingDb: -1,/.test(src('engine/settings.js')) && /Bawaan mesin/.test(selOptionDesc('ceil', '-1')) && src('engine/qc.js').includes('S.lim.ceilingDb + 0.05') && /0,05 dB/.test(selAbout('ceil')));
t.ok('WAV 32-bit float tanpa kuantisasi, jadi tanpa dither', /o\.format === 'wav' && o\.bits === 32\) bytes = encodeWav\(data, outFs, 32, true\)/.test(src('engine/exporter.js')) && /tanpa dither/.test(selOptionDesc('fmt', 'wav:32')));
t.ok('kategori: jumlah genre di teks sama dengan data', CATEGORIES.every((_, i) => selOptionDesc('cat', String(i)).startsWith(GENRES.filter((g) => g.categoryIndex === i).length + ' genre: ')) && selAbout('cat').includes(GENRES.length + ' genre dalam ' + CATEGORIES.length + ' kategori'));
t.ok('voicing memakai deskripsi dari data mesin', Object.keys(VOICINGS).every((k) => selOptionDesc('voicing', k) === VOICINGS[k].desc));

t.section('pemasangan di pop-up');
t.ok('app.js mengimpor sel-info dan memakainya di openSheet', app.includes("from './sel-info.js'") && app.includes('selOptionDesc(sel.id, op.value)') && app.includes('selAbout(sel.id)'));
t.ok('penjelasan disisipkan lewat textContent (bukan innerHTML)', app.includes('s2.textContent = ds') && app.includes('f.textContent = ab'));
t.ok('tinggi pop-up mengikuti isi (tidak ada ruang kosong tetap) dan catatan bawah ber-gaya', /\.sheet\{[^}]*max-height:min\(82vh,600px\)/.test(css) && !/\.sheet\{[^}]*[^-]height:min\(72vh/.test(css) && css.includes('.sheet .sf{') && css.includes('.sheet .so .sd{'));
t.ok('tanpa URL atau jaringan di teks penjelasan', !/https?:|fetch\(/.test(info));

t.section('perilaku pop-up: mengetuk opsi tidak menutup, penutupan lewat X / luar / Escape');
const oc = app.slice(app.indexOf('b.onclick = () => { sel.selectedIndex = i;'), app.indexOf('list.appendChild(b); });'));
t.ok('ketuk opsi memindahkan pilihan (selectedIndex + label + aria-selected) tanpa closeSheet', oc.includes('sel.selectedIndex = i') && oc.includes('syncSel(sel)') && oc.includes("setAttribute('aria-selected', k === i") && !oc.includes('closeSheet') && !oc.includes('dispatchEvent'));
t.ok('event change dikirim saat pop-up ditutup, hanya bila hasil akhir beda dari saat dibuka', /const s = sheetSel, changed = !!s && s\.selectedIndex !== sheetStart/.test(app) && /if \(changed\) s\.dispatchEvent\(new Event\('change'\)\)/.test(app) && app.includes('sheetStart = sel.selectedIndex'));
t.ok('tombol X, ketuk di luar, dan Escape semuanya memanggil closeSheet', app.includes('x.onclick = closeSheet') && /if \(e\.target === back\) closeSheet\(\)/.test(app) && /e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); closeSheet\(\)/.test(app));

t.done();
