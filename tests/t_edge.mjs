// @slow
// tests/t_edge.mjs - kasus tepi pada jalur master + export penuh.
// Janji minimum untuk SEMUA input: tidak melempar error, output finite, panjang/kanal/sample rate terjaga,
// true peak tidak melewati ceiling, dan export lulus verifikasi.
import { suite } from './lib/harness.mjs';
import * as S from './lib/signals.mjs';
import { master, qcStatus } from './lib/pipeline.mjs';
import { measureTruePeak } from '../src/engine/loudness.js';
import { exportAudio } from '../src/engine/exporter.js';

const t = suite('edge');
const FS = 48000;

const CASES = [
  ['sunyi stereo 3 dtk',            FS,     () => S.silence(FS, 3), { silent: true }],
  ['sunyi mono 3 dtk',              FS,     () => S.silence(FS, 3, 1), { silent: true }],
  ['sine -60 dBFS (sangat pelan)',  FS,     () => S.sine(FS, 3, 1000, -60)],
  ['sine 0 dBFS (full scale)',      FS,     () => S.sine(FS, 3, 1000, 0)],
  ['musik mono 5 dtk',              FS,     () => S.music(FS, 5, { ch: 1 })],
  ['musik sangat pelan (-40 dBFS)', FS,     () => S.music(FS, 5, { peakDb: -40 })],
  ['musik sudah clipping keras',    FS,     () => S.driveClip(S.music(FS, 5, { peakDb: 0 }), 12)],
  ['musik dengan DC offset 0.3',    FS,     () => S.music(FS, 5).map((x) => Float32Array.from(x, (v) => v * 0.6 + 0.3)), { dcFixed: true }],
  ['pink noise 5 dtk',              FS,     () => S.pinkNoise(FS, 5, -18)],
  ['sweep 20 Hz-20 kHz',            FS,     () => S.sweep(FS, 5, 20, 20000, -6)],
  ['impuls tunggal 2 dtk',          FS,     () => S.impulse(FS, 2, 1, 0.9)],
  ['pendek 0.5 dtk',                FS,     () => S.music(FS, 0.5)],
  ['pendek 0.1 dtk',                FS,     () => S.music(FS, 0.1)],
  ['pendek 1000 sampel',            FS,     () => S.music(FS, 1000 / FS)],
  ['pendek 100 sampel',             FS,     () => S.music(FS, 100 / FS)],
  ['pendek 10 sampel',              FS,     () => S.music(FS, 10 / FS)],
  ['192 kHz, 2 dtk',                192000, () => S.music(192000, 2)],
  ['44.1 kHz, jumlah sampel ganjil', 44100, () => S.music(44100, 3.0123)],
];

for (const [name, fs, make, flags = {}] of CASES) {
  t.section(name);
  const chans = make(), before = S.md5(chans);
  const r = t.attempt(name + ': master tanpa error', () => master(chans, fs, 'pop-modern', 'modern'));
  if (!r) continue;
  const { out, settings, qc } = r, ceil = settings.lim.ceilingDb;
  t.ok('output finite', S.allFinite(out.chans));
  t.ok('frame, kanal, dan sample rate terjaga', out.chans.length === chans.length && out.chans[0].length === chans[0].length && out.fs === fs, out.chans[0].length + '/' + chans[0].length);
  t.ok('sumber tidak dimodifikasi', S.md5(chans) === before);
  if (flags.silent) {
    t.atMost('hasil tetap diam', S.peakDb(out.chans), -120, ' dBFS');
    for (const id of ['clip', 'tp', 'int']) t.ok('QC ' + id + ' = pass', qcStatus(qc, id) === 'pass', 'status=' + qcStatus(qc, id));
    const bad = qc.filter((q) => q.status === 'fail').map((q) => q.id);
    // diperbaiki di audit 2026-11-19 (NM-14): input sunyi dulu memberi FAIL palsu pada mono dan dyn
    t.ok('QC tidak menandai FAIL untuk input sunyi', bad.length === 0, 'FAIL pada: ' + bad.join(','));
  } else {
    t.atMost('true peak (meter engine) <= ceiling', measureTruePeak(out.chans, fs).dbtp, ceil + 0.05, ' dBTP');
    t.atMost('puncak sampel <= ceiling', S.peakDb(out.chans), ceil + 0.05, ' dBFS');
    t.ok('QC integritas render = pass', qcStatus(qc, 'int') === 'pass');
  }
  if (flags.dcFixed) t.ok('QC DC offset = pass (DC pada sumber dibuang)', qcStatus(qc, 'dc') === 'pass', 'status=' + qcStatus(qc, 'dc'));
  const ex = t.attempt(name + ': export WAV 24-bit tanpa error', () => exportAudio(out.chans, out.fs, { format: 'wav', bits: 24, dither: 'auto', ceilingDb: ceil }));
  if (ex) t.ok('export lulus verifikasi', ex.ok, JSON.stringify(ex.checks.filter((c) => !c.ok)));
}

t.done();
