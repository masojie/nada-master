// tests/t_audit_butter.mjs - audit 2026-11-19: butterSections untuk orde selain 1, 2, 4.
// Dulu orde 3, 5, 6, ... diam-diam menjadi orde 4. Sekarang respons harus sama dengan Butterworth analitik terprewarp:
//   LP: |H|^2 = 1 / (1 + (tan(w/2) / tan(wc/2))^(2n)),  HP: |H|^2 = 1 / (1 + (tan(wc/2) / tan(w/2))^(2n))
import { suite } from './lib/harness.mjs';
import { butterSections, designBiquad, sectionsMagDb } from '../src/engine/biquad.js';

const t = suite('audit-butter');
const ref = (type, n, f, fc, fs) => {
  const a = Math.tan(Math.PI * f / fs), c = Math.tan(Math.PI * fc / fs), r = type === 'lp' ? a / c : c / a;
  return -10 * Math.log10(1 + Math.pow(r, 2 * n));
};
const stable = (s) => Math.abs(s.a2) < 1 && Math.abs(s.a1) < 1 + s.a2;

t.section('respons sama dengan Butterworth analitik, orde 1 sampai 8');
for (const type of ['hp', 'lp']) {
  for (const [fs, fc] of [[44100, 100], [48000, 5000], [96000, 40]]) {
    const worst = [];
    for (let n = 1; n <= 8; n++) {
      const secs = butterSections(type, fc, n, fs);
      let err = 0;
      for (const m of [0.125, 0.25, 0.5, 0.8, 1, 1.25, 2, 4, 8]) { const f = fc * m; if (f < fs * 0.45) err = Math.max(err, Math.abs(sectionsMagDb(secs, f, fs) - ref(type, n, f, fc, fs))); }
      const at = sectionsMagDb(secs, fc, fs);
      t.ok(`${type} orde ${n} @${fs} Hz fc=${fc}: ${secs.length} seksi, selisih maks ${err.toExponential(1)} dB, di fc ${at.toFixed(3)} dB`,
        secs.length === Math.ceil(n / 2) && err < 1e-5 && Math.abs(at + 3.0103) < 1e-3, '');
      if (!secs.every(stable)) worst.push(n);
    }
    t.ok(`${type} @${fs} Hz fc=${fc}: semua seksi stabil (kutub di dalam lingkaran satuan)`, worst.length === 0, worst.length ? 'orde tidak stabil: ' + worst : '');
  }
}

t.section('orde 1, 2, 4 tidak berubah (render yang sudah ada tetap bit-identik)');
for (const type of ['hp', 'lp']) {
  const fs = 48000, f = 80, t1 = type === 'hp' ? 'hp1' : 'lp1';
  const want = { 1: [designBiquad(t1, f, 0.7071, 0, fs)], 2: [designBiquad(type, f, Math.SQRT1_2, 0, fs)],
    4: [designBiquad(type, f, 0.5411961001461969, 0, fs), designBiquad(type, f, 1.3065629648763766, 0, fs)] };
  for (const n of [1, 2, 4]) t.ok(`${type} orde ${n}: koefisien identik dengan implementasi lama`, JSON.stringify(butterSections(type, f, n, fs)) === JSON.stringify(want[n]), '');
}

t.section('masukan tak lazim');
t.ok('orde tidak terdefinisi atau NaN tetap orde 4 seperti dulu', JSON.stringify(butterSections('hp', 100, undefined, 48000)) === JSON.stringify(butterSections('hp', 100, 4, 48000)) && butterSections('lp', 100, NaN, 48000).length === 2, '');
t.ok('orde 0 dan negatif menjadi orde 1', butterSections('hp', 100, 0, 48000).length === 1 && butterSections('hp', 100, -3, 48000).length === 1, '');
t.done();
