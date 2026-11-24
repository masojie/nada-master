// tests/t_rack.mjs - UI Advanced (rack.js) dan daftar genre (genre-view.js): setiap kontrol harus menunjuk ke setting yang benar-benar ada di mesin.
import { suite } from './lib/harness.mjs';
import { GENRES, resolveSettings } from '../src/engine/settings.js';
import { renderRack, getPath, newBand } from '../src/ui/rack.js';
import { genreListHtml, genreFacts } from '../src/ui/genre-view.js';

const t = suite('rack');
const base = { genre: GENRES[0].id, mode: 'modern', voicing: 'balanced', loudness: 'streaming', customLufs: -12, ceilingDb: -1, adaptive: false };
const paths = (html) => {
  const out = new Set();
  for (const m of html.matchAll(/data-(?:p|tog|set|rd)="([^"]+)"/g)) out.add(m[1]);
  return [...out];
};
t.section('rack: semua path kontrol ada di settings');
let total = 0, bad = [], dead = [];
for (const gid of [GENRES[0].id, GENRES[20].id, GENRES[GENRES.length - 1].id]) {
  const s = resolveSettings({ ...base, genre: gid });
  s.eq.bands.push(newBand());
  for (let sel = 0; sel < 5; sel++) for (let mb = 0; mb < 4; mb++) {
    const html = renderRack(s, { ui: { open: { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true, 8: true, 9: true, 10: true, 11: true, 12: true }, eqSel: sel, mbSel: mb, satSel: sel }, fs: 44100 });
    for (const p of paths(html)) { total++; const v = getPath(s, p); if (v === undefined && !/\.slope$/.test(p)) bad.push(gid + ':' + p); }
    if (/NaN|undefined|Infinity/.test(html)) dead.push(gid + ' sel' + sel + '/' + mb);
  }
}
t.ok('tidak ada path kontrol yang tidak dikenal mesin (' + total + ' diperiksa)', bad.length === 0, bad.slice(0, 5).join(' | '));
t.ok('HTML rak tidak berisi NaN / undefined / Infinity', dead.length === 0, dead.slice(0, 5).join(' | '));
{
  const s = resolveSettings(base);
  const html = renderRack(s, { fs: 44100 });
  t.ok('12 unit rak dirender', (html.match(/class="(?:unit|stage)/g) || []).length === 12);
  t.ok('stage yang punya bypass punya tombol bypass (11)', (html.match(/aria-label="[^"]+ bypass"/g) || []).length === 11);
  t.ok('tidak ada jaringan atau URL di HTML rak', !/https?:\/\//.test(html));
  const s2 = JSON.parse(JSON.stringify(s)); s2.eq.bands = [];
  t.ok('EQ tanpa band tetap bisa dirender (unit 02 dibuka)', renderRack(s2, { fs: 44100, ui: { open: { 2: true } } }).includes('Tidak ada band EQ'));
  t.ok('pembukaan pertama: semua unit tertutup (aria-expanded=false, tanpa isi)', (renderRack(s2, { fs: 44100 }).match(/aria-expanded=false/g) || []).length === 12 && !renderRack(s2, { fs: 44100 }).includes('Tidak ada band EQ'));
}

t.section('genre-view: daftar genre dari katalog mesin');
{
  const list = GENRES.filter((g) => g.categoryIndex === 0), cur = list[0];
  const html = genreListHtml(list, cur.id, list[1].id);
  t.ok('satu tombol per genre', (html.match(/data-toggle="/g) || []).length === list.length);
  t.ok('detail hanya untuk genre yang dibuka', (html.match(/class=gdet/g) || []).length === 1);
  t.ok('tombol pakai genre mengirim id yang benar', html.includes('data-use="' + list[1].id + '"'));
  let bad = '';
  for (const g of GENRES) { try { const h = genreListHtml([g], null, g.id); if (/NaN|undefined/.test(h)) bad = g.id; const f = genreFacts(g); if (!f.lufs || !f.tilt) bad = g.id; } catch (e) { bad = g.id + ' ' + e.message; } if (bad) break; }
  t.ok('semua ' + GENRES.length + ' genre dirender bersih', bad === '', bad);
}
t.done();
