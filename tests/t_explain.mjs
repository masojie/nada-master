// tests/t_explain.mjs - penjelasan Mastering style dan detail metrik harus cocok dengan perilaku mesin
import fs from 'fs';
import { suite } from './lib/harness.mjs';
import { MODE_INFO, METRIC_INFO } from '../src/ui/explain.js';
import { MODES, GENRES, modeTarget, resolveSettings } from '../src/engine/settings.js';

const t = suite('explain');
const app = fs.readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');

t.section('Mastering style: satu penjelasan per mode, angka cocok dengan resolveSettings dan modeTarget');
t.ok('semua mode di MODES punya penjelasan dan detail', MODES.every((m) => MODE_INFO[m.id] && MODE_INFO[m.id].plain && MODE_INFO[m.id].fx.length > 0), MODES.map((m) => m.id).join(','));
const lim = { transparent: 1.5, warm: 2.5, modern: 3.5, loud: 6, dynamic: 1.5 };
for (const m of MODES) {
  const s = resolveSettings({ genre: GENRES[0].id, mode: m.id });
  t.near(m.id + ': batas penekanan limiter (LU) sesuai teks', s.loud.maxLimitLu, lim[m.id], 1e-9);
  t.ok(m.id + ': teks menyebut "' + String(lim[m.id]).replace('.', ',') + ' LU"', MODE_INFO[m.id].fx.some((x) => x.includes(String(lim[m.id]).replace('.', ',') + ' LU')));
}
const L = -11;
t.near('transparent: yang lebih pelan antara target genre dan -14', modeTarget('transparent', L), Math.min(-14, L), 1e-9);
t.near('warm: 0,5 LUFS lebih pelan', modeTarget('warm', L), L - 0.5, 1e-9);
t.near('modern: sama dengan target genre', modeTarget('modern', L), L, 1e-9);
t.near('loud: target +1,5 tapi tidak lebih keras dari -7,5', modeTarget('loud', -6), -7.5, 1e-9);
t.near('dynamic: 3 LUFS lebih pelan, dibatasi -18..-14', modeTarget('dynamic', -20), -18, 1e-9);

t.section('Detail metrik: semua baris tabel Analysis punya penjelasan lengkap');
const labels = [...app.matchAll(/\['([^']+)', \(x\) => [^\]]*?, '[^']*', \d\]/g)].map((m) => m[1]);
t.ok('tabel punya 24 metrik', labels.length === 24, 'jumlah=' + labels.length);
for (const l of labels) {
  const i = METRIC_INFO[l];
  t.ok('metrik "' + l + '": title, how, read, src terisi', !!(i && i.title && i.how && i.how.length && i.read && i.src));
}
t.done();
