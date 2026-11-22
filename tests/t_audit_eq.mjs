// tests/t_audit_eq.mjs - regresi audit 2026-11-19: NM-07 (akurasi linear-phase EQ di low-end) dan PERF-1 (DynEQ satu filter per band)
import { suite } from './lib/harness.mjs';
import { EQStage, LinearPhaseEQStage, DynEQStage, runBlockStage } from '../src/engine/modules.js';

const t = suite('audit-eq');
const tone = (f, fs, sec = 3) => { const n = Math.round(fs * sec), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.1 * Math.sin(2 * Math.PI * f * i / fs); return x; };
const lvl = (y) => { let s = 0, c = 0; for (let i = y.length >> 1; i < y.length - 2048; i++) { s += y[i] * y[i]; c++; } return 20 * Math.log10(Math.sqrt(s / c) / (0.1 / Math.SQRT2)); };
const bands = [{ on: true, type: 'hp', f: 30, slope: 24, ch: 'stereo' }, { on: true, type: 'bell', f: 100, q: 4, g: -6, ch: 'stereo' }, { on: true, type: 'lowshelf', f: 60, q: 0.7, g: 3, ch: 'stereo' }];

for (const fs of [44100, 96000]) {
  t.section('NM-07 @' + fs);
  for (const f of [25, 30, 40, 60, 100, 150, 1000, 10000]) {
    const a = [tone(f, fs), tone(f, fs)], b = [tone(f, fs), tone(f, fs)];
    runBlockStage(new EQStage({ bands }, fs, 2), a); runBlockStage(new LinearPhaseEQStage({ bands }, fs, 2), b);
    t.near('linear-phase = minimum-phase di ' + f + ' Hz', lvl(b[0]), lvl(a[0]), 0.5, ' dB');
  }
}

t.section('PERF-1: DynEQ satu filter per band');
{
  const fs = 48000, p = { autoThr: false, bands: [{ on: true, name: 'x', f: 3300, q: 1.4, thrDb: -40, ratio: 3, attackMs: 3, releaseMs: 80, rangeDb: 6, ch: 'stereo' }] };
  const m = new DynEQStage(p, fs, 2, null);
  t.ok('tidak ada biquad duplikat untuk jalur audio', !('aM' in m.bands[0]) && !('aS' in m.bands[0]));
  const x = [tone(3300, fs, 1), tone(3300, fs, 1)]; runBlockStage(m, x);
  t.ok('DynEQ tetap menurunkan level di atas threshold', lvl(x[0]) < -1, 'level=' + lvl(x[0]).toFixed(2) + ' dB');
  const q = [tone(3300, fs, 1), tone(3300, fs, 1)].map((c) => c.map((v) => v * 0.001)), q0 = Float32Array.from(q[0]);
  runBlockStage(new DynEQStage(p, fs, 2, null), q); let md = 0; for (let i = 0; i < q0.length; i++) md = Math.max(md, Math.abs(q[0][i] - q0[i]));
  t.ok('transparan di bawah threshold', md < 1e-9, 'maxdiff=' + md);
}

t.done();
