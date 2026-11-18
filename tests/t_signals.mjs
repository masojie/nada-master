// tests/t_signals.mjs - tes untuk alat ukur dan generator sinyal uji (tests/lib/signals.mjs).
// Alat uji yang salah membuat tes lain tidak berarti, jadi alat ujinya diuji dulu.
import { suite } from './lib/harness.mjs';
import * as S from './lib/signals.mjs';

const t = suite('signals');
const fsList = [44100, 48000, 96000];

t.section('PRNG');
{
  const a = S.rng(42), b = S.rng(42), c = S.rng(43);
  let same = true, mean = 0, lo = 1, hi = 0, diff = false;
  for (let i = 0; i < 100000; i++) { const x = a(), y = b(), z = c(); if (x !== y) same = false; if (x !== z) diff = true; mean += x; lo = Math.min(lo, x); hi = Math.max(hi, x); }
  t.ok('seed sama menghasilkan urutan sama', same);
  t.ok('seed berbeda menghasilkan urutan berbeda', diff);
  t.near('rata-rata mendekati 0.5', mean / 100000, 0.5, 0.01);
  t.ok('rentang [0,1)', lo >= 0 && hi < 1);
}

t.section('sine, silence, dc, impulse');
for (const fs of fsList) {
  const x = S.sine(fs, 2, 1000, -6);
  t.near('sine ' + fs + ' puncak -6 dBFS', S.peakDb(x), -6, 0.01, ' dB');
  t.near('sine ' + fs + ' RMS = puncak - 3.01 dB', S.rmsDb(x), -6 - 3.0103, 0.02, ' dB');
  t.ok('sine ' + fs + ' dua kanal identik', S.maxAbsDiff([x[0]], [x[1]]) === 0);
}
t.ok('silence semua nol', S.peak(S.silence(48000, 1)) === 0 && S.silence(48000, 1, 1).length === 1);
{ const d = S.dcOffset(48000, 1, 0.25); t.near('dcOffset level', d[0][1234], 0.25, 1e-7); }
{
  const x = S.impulse(48000, 2, 1, 0.9);
  let nz = 0, pos = -1;
  for (let i = 0; i < x[0].length; i++) if (x[0][i] !== 0) { nz++; pos = i; }
  t.ok('impuls: tepat satu sampel tidak nol', nz === 1);
  t.ok('impuls: posisi 1.0 detik', pos === 48000);
  t.near('impuls: amplitudo', x[0][pos], 0.9, 1e-6);
}

t.section('sweep');
{
  const fs = 48000, x = S.sweep(fs, 4, 20, 20000, -6)[0], n = x.length;
  const zc = (a, b) => { let c = 0; for (let i = a + 1; i < b; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) c++; return c; };
  const early = zc(0, Math.floor(n * 0.1)), late = zc(Math.floor(n * 0.9), n);
  t.ok('sweep: frekuensi naik (zero-crossing akhir >> awal)', late > early * 20, 'awal=' + early + ' akhir=' + late);
  t.atMost('sweep: puncak tidak melebihi -6 dBFS', S.peakDb([x]), -5.99, ' dB');
  t.ok('sweep: finite', S.allFinite([x]));
}

t.section('pink noise');
{
  const fs = 48000, a = S.pinkNoise(fs, 5, -20, 11), b = S.pinkNoise(fs, 5, -20, 11), c = S.pinkNoise(fs, 5, -20, 12);
  t.ok('pink: seed sama = bit-identik', S.md5(a) === S.md5(b));
  t.ok('pink: seed beda = berbeda', S.md5(a) !== S.md5(c));
  t.near('pink: RMS sesuai target', S.rmsDb(a), -20, 0.05, ' dB');
  let sl = 0, sr = 0, sx = 0;
  for (let i = 0; i < a[0].length; i++) { sl += a[0][i] ** 2; sr += a[1][i] ** 2; sx += a[0][i] * a[1][i]; }
  t.atMost('pink: kanal L dan R tidak berkorelasi', Math.abs(sx / Math.sqrt(sl * sr)), 0.05);
  let d = 0, e = 0; const x = a[0];
  for (let i = 1; i < x.length; i++) { d += (x[i] - x[i - 1]) ** 2; e += x[i] ** 2; }
  t.atMost('pink: lebih redup di treble daripada white (rasio turunan < 1)', Math.sqrt(d / e), 1.0);
}

t.section('music');
for (const style of ['pop', 'ballad', 'dance']) {
  const fs = 48000, x = S.music(fs, 8, { style, peakDb: -3 }), crest = S.peakDb(x) - S.rmsDb(x);
  t.near('music/' + style + ' puncak sesuai permintaan', S.peakDb(x), -3, 0.01, ' dB');
  t.ok('music/' + style + ' finite dan tidak diam', S.allFinite(x) && S.rmsDb(x) > -40, 'rms=' + S.rmsDb(x).toFixed(1) + ' dB');
  t.ok('music/' + style + ' crest factor realistis (8 sampai 18 dB)', crest > 8 && crest < 18, 'crest=' + crest.toFixed(1) + ' dB');
  t.ok('music/' + style + ' stereo (L tidak sama dengan R)', S.maxAbsDiff([x[0]], [x[1]]) > 1e-3);
  let sl = 0, sr = 0, sx = 0;
  for (let i = 0; i < x[0].length; i++) { sl += x[0][i] ** 2; sr += x[1][i] ** 2; sx += x[0][i] * x[1][i]; }
  const rho = sx / Math.sqrt(sl * sr);
  t.ok('music/' + style + ' korelasi stereo wajar (0.5 sampai 0.999)', rho > 0.5 && rho < 0.999, 'rho=' + rho.toFixed(3));
}
{
  const a = S.music(48000, 3, { seed: 7 }), b = S.music(48000, 3, { seed: 7 }), c = S.music(48000, 3, { seed: 8 });
  t.ok('music: seed sama = bit-identik', S.md5(a) === S.md5(b));
  t.ok('music: seed beda = berbeda', S.md5(a) !== S.md5(c));
  const m = S.music(48000, 3, { ch: 1, peakDb: -6 });
  t.ok('music: varian mono punya 1 kanal', m.length === 1);
  t.near('music: varian mono puncak sesuai permintaan', S.peakDb(m), -6, 0.01, ' dB');
  t.near('music: level 0 dBFS', S.peakDb(S.music(48000, 2, { peakDb: 0 })), 0, 0.01, ' dB');
}

t.section('driveClip, scaleDb, copy');
{
  const x = S.music(48000, 4, { peakDb: 0 }), y = S.driveClip(x, 12);
  let clipped = 0, n = 0;
  for (const ch of y) for (let i = 0; i < ch.length; i++) { n++; if (Math.abs(ch[i]) === 1) clipped++; }
  t.ok('driveClip: puncak persis 0 dBFS', S.peak(y) === 1);
  t.atLeast('driveClip: sebagian sampel terpotong', clipped / n, 0.001);
  const h = S.scaleDb(x, -6.0206), c = S.copy(x);
  t.near('scaleDb -6.02 dB menyetengahkan amplitudo', S.peak(h) / S.peak(x), 0.5, 1e-3);
  c[0][0] += 1;
  t.ok('copy tidak berbagi memori dengan aslinya', x[0][0] !== c[0][0]);
}

t.section('pengukur: finite, selisih, md5');
{
  const x = S.music(48000, 1), y = S.copy(x);
  t.ok('allFinite true untuk sinyal normal', S.allFinite(x));
  y[1][100] = NaN;
  t.ok('allFinite false bila ada NaN', !S.allFinite(y));
  y[1][100] = Infinity;
  t.ok('allFinite false bila ada Infinity', !S.allFinite(y));
  t.ok('maxAbsDiff nol untuk salinan', S.maxAbsDiff(x, S.copy(x)) === 0);
  t.ok('md5 stabil untuk isi yang sama', S.md5(x) === S.md5(S.copy(x)));
}

t.section('true peak independen (jawaban pasti)');
{
  const fs = 48000;
  t.near('sine 997 Hz 0 dBFS: true peak 0 dBTP', S.truePeakDb(S.sine(fs, 1, 997, 0), 2048), 0, 0.02, ' dB');
  const isp = S.interSamplePeak(fs, 1, -1);
  t.near('inter-sample peak: puncak sampel -1 dBFS', S.peakDb(isp), -1, 0.01, ' dB');
  t.near('inter-sample peak: true peak = -1 + 3.01 = +2.01 dBTP', S.truePeakDb(isp, 2048), 2.0103, 0.03, ' dB');
  t.ok('true peak tidak pernah lebih kecil dari puncak sampel', S.truePeakDb(S.music(fs, 3), 0) >= S.peakDb(S.music(fs, 3)) - 1e-9);
  t.ok('true peak sinyal diam = -600', S.truePeakDb(S.silence(fs, 1)) === -600);
}

t.done();
