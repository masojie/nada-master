// tests/t_audit_tp.mjs - regresi audit 2026-11-19: NM-03 (true peak materi HF-padat) dan NM-15 (oversampling di >= 120 kHz)
import { suite } from './lib/harness.mjs';
import * as S from './lib/signals.mjs';
import { runLimiter } from '../src/engine/limiter.js';
import { measureTruePeak } from '../src/engine/loudness.js';
import { TPInterp } from '../src/engine/oversample.js';

const t = suite('audit-tp');
const hfNoise = (fs, sec) => S.pinkNoise(fs, sec, -6, 3).map((c) => { const y = new Float32Array(c.length); for (let i = 1; i < c.length; i++) y[i] = (c[i] - c[i - 1]) * 3; return y; });

t.section('NM-03: limiter menahan true peak materi HF-padat');
for (const fs of [44100, 48000, 96000]) {
  const x = hfNoise(fs, 3);
  runLimiter(x, { ceilingDb: -1, lookaheadMs: 3, releaseMs: 100, style: 'balanced', autoRelease: true, tpDetect: true }, fs);
  const eng = measureTruePeak(x, fs).dbtp, ind = S.truePeakDb(x);
  t.atMost('meter engine <= ceiling + 0.05 @' + fs, eng, -1 + 0.05, ' dBTP');
  t.atMost('estimator independen <= ceiling + 0.1 @' + fs, ind, -1 + 0.1, ' dBTP');
  t.near('engine vs independen <= 0.1 dB @' + fs, eng, ind, 0.1, ' dB');
}

t.section('pre-pass murah tidak mengubah hasil');
{
  const fs = 44100, x = hfNoise(fs, 2)[0], tp = new TPInterp(4), a = new Float32Array(x.length), b = new Float32Array(x.length);
  tp.segMax(x, a); let mx = 0, sp = 0; for (let i = 0; i < x.length; i++) { mx = Math.max(mx, a[i]); sp = Math.max(sp, Math.abs(x[i])); }
  tp.segMax(x, b, sp); let mxB = 0, bad = 0; for (let i = 0; i < x.length; i++) { mxB = Math.max(mxB, b[i]); if (a[i] >= sp && a[i] !== b[i]) bad++; }
  t.ok('maksimum identik dengan evaluasi penuh', mx === mxB, mx + ' vs ' + mxB);
  t.ok('setiap nilai >= ambang dihitung eksak', bad === 0, bad + ' beda');
}

t.section('NM-15: true peak di 176.4/192 kHz memakai oversampling');
for (const fs of [44100, 96000, 176400, 192000]) {
  const a = new Float32Array(fs); for (let i = 0; i < fs; i++) a[i] = Math.sin(Math.PI / 2 * i + Math.PI / 4);
  t.near('sinus fs/4 fase 45 derajat terbaca 0 dBTP @' + fs, measureTruePeak([a], fs).dbtp, 0, 0.2, ' dB');
}

t.done();
