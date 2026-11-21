// tests/t_audit_analysis.mjs - regresi audit 2026-11-19: NM-01 (oktaf 16 kHz di 44.1 kHz), NM-02 (resonansi palsu), NM-13 (cakupan frame)
import { suite } from './lib/harness.mjs';
import * as S from './lib/signals.mjs';
import { analyzeAudio } from '../src/engine/analysis.js';
import { resolveSettings, getGenre } from '../src/engine/settings.js';
import { planAdaptive } from '../src/engine/adaptive.js';

const t = suite('audit-analysis');
const white = (fs, sec, seed) => { const r = S.rng(seed), n = Math.round(fs * sec), L = new Float32Array(n), R = new Float32Array(n); for (let i = 0; i < n; i++) { L[i] = (r() - 0.5) * 0.3; R[i] = (r() - 0.5) * 0.3; } return [L, R]; };
const plan = (an) => planAdaptive(resolveSettings({ genre: 'pop-modern', mode: 'modern' }), an, getGenre('pop-modern'));
const addTone = (x, fs, f, amp, fromSec = 0) => { const from = Math.round(fs * fromSec); for (const c of x) for (let i = from; i < c.length; i++) c[i] += amp * Math.sin(2 * Math.PI * f * i / fs); return x; };

t.section('NM-01: oktaf 16 kHz terukur dan konsisten antar sample rate');
const rel = {};
for (const fs of [44100, 48000]) {
  const an = analyzeAudio(S.pinkNoise(fs, 12, -20, 11), fs);
  rel[fs] = an.spectrum.octaveRel[9];
  t.ok('octaveRel 16 kHz finite @' + fs, Number.isFinite(rel[fs]), 'nilai=' + rel[fs]);
  t.ok('tidak ada octaveRel < -100 dB @' + fs, an.spectrum.octaveRel.every((v) => !(v < -100)), an.spectrum.octaveRel.map((v) => v.toFixed(1)).join(','));
  const g16 = plan(an).settings.eq.bands.filter((b) => b.auto && b.type === 'highshelf').map((b) => b.g);
  t.ok('pink noise tidak mendapat boost shelf 16 kHz @' + fs, g16.every((g) => g <= 0), 'gain=' + g16.join(','));
}
t.near('octaveRel 16 kHz pink noise 44.1 vs 48 kHz', rel[44100], rel[48000], 1.5, ' dB');

t.section('NM-02: tidak ada resonansi palsu pada noise');
for (const fs of [44100, 48000, 96000]) {
  for (const [name, x] of [['pink', S.pinkNoise(fs, 10, -20, 5)], ['white', white(fs, 10, 9)]]) {
    const r = analyzeAudio(x, fs).spectrum.resonances;
    t.ok(name + ' noise @' + fs + ': tanpa resonansi', r.length === 0, JSON.stringify(r));
  }
}
{
  const fs = 44100, r = analyzeAudio(addTone(S.pinkNoise(fs, 10, -20, 5), fs, 1000, 0.05), fs).spectrum.resonances;
  t.ok('resonansi nyata 1 kHz tetap terdeteksi', r.some((q) => Math.abs(q.freq - 1000) < 40), JSON.stringify(r));
}

t.section('NM-13: tes persistensi memakai seluruh lagu');
{
  // 100 s, tone hanya mulai detik 40: kode lama hanya melihat sekitar 59 s pertama (persistensi 33%) dan melewatkannya
  const fs = 44100, r = analyzeAudio(addTone(S.pinkNoise(fs, 100, -20, 7, 1), fs, 1000, 0.05, 40), fs).spectrum.resonances;
  t.ok('resonansi yang hanya ada di 60% akhir lagu terdeteksi', r.some((q) => Math.abs(q.freq - 1000) < 40), JSON.stringify(r));
}

t.done();
