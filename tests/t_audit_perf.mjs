// tests/t_audit_perf.mjs - audit 2026-11-19, PERF-2 dan PERF-4: buffer kerja pass limiter/true-peak dipakai ulang.
// Janji yang dijaga: memakai `scratch` tidak boleh mengubah satu bit pun hasil. Kesalahan khas yang ditangkap di sini:
// seg tidak dikosongkan antar pass (puncak pass yang lebih keras bocor ke pass berikutnya), tmp/deque basi, scratch yang
// tidak diganti saat panjang atau faktor oversample berubah.
import { suite } from './lib/harness.mjs';
import * as S from './lib/signals.mjs';
import { runLimiter } from '../src/engine/limiter.js';
import { measureTruePeak } from '../src/engine/loudness.js';
import { TPInterp } from '../src/engine/oversample.js';

const t = suite('audit-perf');
const P = { ceilingDb: -1, lookaheadMs: 3, releaseMs: 100, autoRelease: true, style: 'balanced', tpDetect: true };
const metrics = (r) => JSON.stringify({ ...r, grSeries: undefined });
const same = (a, b) => S.md5(a) === S.md5(b);

t.section('PERF-2: runLimiter dengan scratch sama persis dengan tanpa scratch, lintas pass');
{
  const fs = 44100, src = S.music(fs, 3, { style: 'dance', peakDb: -3 }), sc = {};
  let allSame = true, firstSeg = null, reused = true;
  for (const g of [8, 0, 4, 10, -3]) { // sengaja keras dulu lalu pelan: seg yang tidak dikosongkan akan membocorkan puncak
    const a = S.scaleDb(src, g), b = S.scaleDb(src, g);
    const ra = runLimiter(a, P, fs, { marginDb: 0.02, scratch: sc }), rb = runLimiter(b, P, fs, { marginDb: 0.02 });
    const ok = same(a, b) && same([ra.grSeries], [rb.grSeries]) && metrics(ra) === metrics(rb);
    if (!ok) allSame = false;
    if (!firstSeg) firstSeg = sc.seg; else if (sc.seg !== firstSeg) reused = false;
    t.ok('pass gain ' + g + ' dB: audio, grSeries dan metrik identik', ok, ok ? '' : 'beda: ' + metrics(ra).slice(0, 80) + ' vs ' + metrics(rb).slice(0, 80));
  }
  t.ok('lima pass memakai buffer seg yang sama (tidak dialokasi ulang)', allSame && reused, '');
}

t.section('PERF-2: scratch diganti benar saat panjang atau faktor oversample berubah');
{
  const sc = {};
  for (const [fs, sec] of [[44100, 3], [48000, 2], [192000, 1], [44100, 1]]) { // 44,1/48 kHz -> 4x, 192 kHz -> 2x
    const src = S.music(fs, sec, { style: 'pop', peakDb: -2 }), a = S.scaleDb(src, 6), b = S.scaleDb(src, 6);
    const ra = runLimiter(a, P, fs, { scratch: sc }), rb = runLimiter(b, P, fs, {});
    t.ok(fs + ' Hz, ' + sec + ' s: sama dengan tanpa scratch (factor ' + ra.tpFactor + ')', same(a, b) && metrics(ra) === metrics(rb), '');
  }
}

t.section('PERF-4: measureTruePeak dengan scratch yang juga dipakai limiter');
{
  const fs = 44100, src = S.music(fs, 3, { style: 'dance', peakDb: -1 }), sc = {};
  runLimiter(S.scaleDb(src, 9), P, fs, { scratch: sc }); // scratch sudah "kotor" oleh pass limiter
  const x = S.scaleDb(src, -6), a = measureTruePeak(x, fs, 0, sc), b = measureTruePeak(x, fs);
  t.ok('dbtp dan per kanal identik', a.dbtp === b.dbtp && a.perChannelDb.every((v, i) => v === b.perChannelDb[i]), a.dbtp.toFixed(3) + ' vs ' + b.dbtp.toFixed(3));
  const hop = 4410, c = measureTruePeak(x, fs, hop, sc), d = measureTruePeak(x, fs, hop);
  t.ok('seri per hop identik', same([c.series], [d.series]), '');
}

t.section('PERF-4: deque TPInterp dipakai ulang tanpa mengubah hasil');
{
  const fs = 44100, loud = S.music(fs, 4, { style: 'dance', peakDb: -0.5 }), quiet = S.music(fs, 1, { style: 'pop', peakDb: -12 });
  const tp = new TPInterp(4), o1 = new Float32Array(loud[0].length), o2 = new Float32Array(quiet[0].length), o3 = new Float32Array(quiet[0].length);
  tp.segMax(loud[0], o1, 0.5); tp.segMax(quiet[0], o2, 0.05); // deque sudah terisi dari sinyal panjang yang keras
  new TPInterp(4).segMax(quiet[0], o3, 0.05);
  t.ok('segMax pada sinyal pendek sesudah sinyal panjang = instance baru', same([o2], [o3]), '');
}
t.done && t.done();
