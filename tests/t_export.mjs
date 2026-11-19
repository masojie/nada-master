// @slow
// tests/t_export.mjs - jalur export: WAV 16/24/32f, FLAC 16/24, konversi sample rate, mode dither.
// Semua kombinasi yang ada di menu Export UI dicoba pada hasil master sintetis.
import { createHash } from 'crypto';
import { suite } from './lib/harness.mjs';
import * as S from './lib/signals.mjs';
import { master } from './lib/pipeline.mjs';
import { exportAudio } from '../src/engine/exporter.js';
import { decodeWav } from '../src/engine/codecs.js';
import { decodeFlac } from '../src/engine/flac.js';

const t = suite('export');
const FS = 48000, SEC = 5, TP_HARD = 0.5;

function mastered(ch = 2) {
  const r = master(S.music(FS, SEC, { style: 'pop', peakDb: -3, ch }), FS, 'pop-modern', 'modern');
  return { out: r.out, ceil: r.settings.lim.ceilingDb };
}
const md5 = (u8) => createHash('md5').update(u8).digest('hex');
const ascii = (u8, a, b) => String.fromCharCode(...u8.subarray(a, b));
const decode = (fmt, bytes) => (fmt === 'flac' ? decodeFlac(bytes) : decodeWav(bytes));
const errRms = (a, b) => { let s = 0, n = 0; for (let c = 0; c < a.length; c++) for (let i = 0; i < a[c].length; i++) { const d = a[c][i] - b[c][i]; s += d * d; n++; } return S.linToDb(Math.sqrt(s / n)); };

const { out, ceil } = mastered();
const n = out.chans[0].length;

t.section('format pada sample rate asli (' + FS + ' Hz)');
const FORMATS = [
  { format: 'wav', bits: 24, tol: 4 / 8388608 },
  { format: 'wav', bits: 16, tol: 16 / 32768 },
  { format: 'wav', bits: 32, tol: 0 },
  { format: 'flac', bits: 24, tol: 4 / 8388608 },
  { format: 'flac', bits: 16, tol: 16 / 32768 },
];
for (const f of FORMATS) {
  const label = f.format.toUpperCase() + ' ' + f.bits + (f.bits === 32 ? 'f' : '') + '-bit';
  const r = t.attempt(label + ': export tanpa error', () => exportAudio(out.chans, out.fs, { format: f.format, bits: f.bits, dither: 'auto', ceilingDb: ceil }));
  if (!r) continue;
  t.ok(label + ': semua pemeriksaan internal lulus', r.ok, JSON.stringify(r.checks.filter((c) => !c.ok)));
  t.ok(label + ': sample rate tetap', r.fs === FS);
  t.ok(label + ': header file benar', f.format === 'flac' ? ascii(r.bytes, 0, 4) === 'fLaC' : ascii(r.bytes, 0, 4) === 'RIFF' && ascii(r.bytes, 8, 12) === 'WAVE');
  const back = decode(f.format, r.bytes);
  t.ok(label + ': decode ulang punya panjang dan kanal yang sama', back.chans.length === out.chans.length && back.chans[0].length === n, back.chans[0].length + '/' + n);
  t.atMost(label + ': selisih maksimum terhadap master', S.maxAbsDiff(out.chans, back.chans), f.tol + 1e-9);
  t.atMost(label + ': puncak setelah kuantisasi <= ceiling', S.peakDb(back.chans), ceil + 0.1, ' dBFS');
}

t.section('konversi sample rate');
for (const sr of [44100, 88200, 96000]) {
  const r = t.attempt(sr + ' Hz: export tanpa error', () => exportAudio(out.chans, out.fs, { format: 'wav', bits: 24, sampleRate: sr, dither: 'auto', ceilingDb: ceil }));
  if (!r) continue;
  const back = decodeWav(r.bytes), want = Math.round(n * sr / FS);
  t.ok(sr + ' Hz: semua pemeriksaan internal lulus', r.ok, JSON.stringify(r.checks.filter((c) => !c.ok)));
  t.ok(sr + ' Hz: sample rate file = ' + sr, back.fs === sr && r.fs === sr);
  t.ok(sr + ' Hz: panjang sesuai rasio (+-2 frame)', Math.abs(back.chans[0].length - want) <= 2, back.chans[0].length + ' vs ' + want);
  t.near(sr + ' Hz: level RMS terjaga', S.rmsDb(back.chans), S.rmsDb(out.chans), 0.1, ' dB');
  t.atMost(sr + ' Hz: true peak independen <= ceiling + ' + TP_HARD + ' dB', S.truePeakDb(back.chans), ceil + TP_HARD, ' dBTP');
}

t.section('mode dither');
{
  const run = (bits, dither, sampleRate) => exportAudio(out.chans, out.fs, { format: 'wav', bits, dither, sampleRate, ceilingDb: ceil });
  const expectMode = [
    ['auto', 16, 0, 'shaped'], ['auto', 24, 0, 'tpdf'], ['auto', 16, 96000, 'tpdf'], ['tpdf', 16, 0, 'tpdf'],
    ['shaped', 16, 0, 'shaped'], ['shaped', 16, 96000, 'tpdf'], ['none', 16, 0, 'none'], ['auto', 32, 0, 'none'],
  ];
  for (const [d, bits, sr, want] of expectMode) {
    const r = t.attempt('dither ' + d + ' @' + bits + (sr ? '/' + sr : '') + ': export', () => run(bits, d, sr));
    if (r) { t.ok('dither ' + d + ' @' + bits + (sr ? '/' + sr : '') + ' dipetakan ke "' + want + '"', r.dither === want, 'mode=' + r.dither); t.ok('dither ' + d + ' @' + bits + ': pemeriksaan lulus', r.ok); }
  }
  const tp = decodeWav(run(16, 'tpdf').bytes);
  const e = errRms(out.chans, tp.chans);
  t.ok('TPDF 16-bit: derau kuantisasi sekitar -96 dBFS', e > -99 && e < -93, e.toFixed(1) + ' dBFS');
  const none = decodeWav(run(16, 'none').bytes);
  t.atMost('tanpa dither: selisih maksimum <= 0.5 LSB', S.maxAbsDiff(out.chans, none.chans), 0.5 / 32768 + 1e-9);
}

t.section('determinisme dan mono');
{
  const a = exportAudio(out.chans, out.fs, { format: 'wav', bits: 16, dither: 'auto', ceilingDb: ceil }), b = exportAudio(out.chans, out.fs, { format: 'wav', bits: 16, dither: 'auto', ceilingDb: ceil });
  t.ok('export dua kali = byte identik (dither ber-seed)', md5(a.bytes) === md5(b.bytes));
  const c = exportAudio(out.chans, out.fs, { format: 'flac', bits: 24, ceilingDb: ceil }), d = exportAudio(out.chans, out.fs, { format: 'flac', bits: 24, ceilingDb: ceil });
  t.ok('export FLAC dua kali = byte identik', md5(c.bytes) === md5(d.bytes));
  const m = mastered(1);
  for (const f of [{ format: 'wav', bits: 24 }, { format: 'flac', bits: 16 }]) {
    const r = t.attempt('mono ' + f.format + ' ' + f.bits + ': export', () => exportAudio(m.out.chans, m.out.fs, { ...f, dither: 'auto', ceilingDb: m.ceil }));
    if (r) { t.ok('mono ' + f.format + ' ' + f.bits + ': lulus dan 1 kanal', r.ok && decode(f.format, r.bytes).chans.length === 1); }
  }
}

t.done();
