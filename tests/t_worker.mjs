// @slow
// tests/t_worker.mjs - bundel worker HASIL BUILD (dist/engine-worker.js) dijalankan di Node dan diajak
// "bicara" lewat protokol pesan yang sama dengan UI: decode / pcm / plan / master / export.
// Yang diuji adalah kode yang benar-benar dikirim ke browser, jadi kesalahan bundler ikut tertangkap.
import { suite } from './lib/harness.mjs';
import * as S from './lib/signals.mjs';
import { buildDist } from './lib/build.mjs';
import { createWorkerHost } from './lib/worker-host.mjs';
import { makeAiff } from './lib/aiff.mjs';
import { quantize } from '../src/engine/dither.js';
import { encodeWav } from '../src/engine/codecs.js';
import { encodeFlac } from '../src/engine/flac.js';

const t = suite('worker');
const FS = 48000;
const ascii = (u8, a, b) => String.fromCharCode(...u8.subarray(a, b));
const of = (msgs, type) => msgs.filter((m) => m.type === type);
const OPTS = { genre: 'pop-modern', mode: 'modern', voicing: 'balanced', loudness: 'auto', customLufs: -12, ceilingDb: -1, adaptive: true };

const { worker } = t.attempt('build dan baca dist/engine-worker.js', buildDist) || {};
if (!worker) t.done();
const fresh = () => createWorkerHost(worker);

t.section('pesan yang tidak valid');
{
  const h = fresh();
  t.ok('master sebelum ada audio -> error "No audio loaded"', of(h.send({ type: 'master', opts: OPTS }), 'error').some((e) => /No audio loaded/.test(e.message)));
  t.ok('export sebelum ada hasil master -> error "Nothing mastered yet"', of(h.send({ type: 'export', opts: { format: 'wav', bits: 24 } }), 'error').some((e) => /Nothing mastered yet/.test(e.message)));
  t.ok('plan sebelum ada audio diabaikan tanpa error', h.send({ type: 'plan', opts: OPTS }).length === 0);
  const junk = new Uint8Array(4096).map((_, i) => (i * 31) & 255).buffer;
  t.ok('file tidak dikenal -> error "Unsupported file format"', of(h.send({ type: 'decode', buffer: junk, name: 'sampah.bin' }), 'error').some((e) => /Unsupported/.test(e.message)));
  t.ok('worker tetap hidup setelah error (masih bisa memuat audio)', of(h.send({ type: 'pcm', chans: S.music(FS, 1), fs: FS, info: { name: 'x' } }), 'loaded').length === 1);
}

t.section('alur lengkap: pcm -> plan -> master -> export');
const h = fresh(), src = S.music(FS, 6, { style: 'pop', peakDb: -3 });
let planMsg = null, mastered = null;
{
  const msgs = h.send({ type: 'pcm', chans: src.map((x) => Float32Array.from(x)), fs: FS, info: { name: 'sintetis.wav', size: 1 } });
  const loaded = of(msgs, 'loaded')[0];
  t.ok('worker membalas "loaded"', !!loaded);
  if (loaded) {
    t.ok('info: fs, kanal, frame, durasi benar', loaded.info.fs === FS && loaded.info.channels === 2 && loaded.info.frames === src[0].length && Math.abs(loaded.info.duration - 6) < 1e-6);
    t.ok('analisis sumber ada dan finite', !!loaded.analysis && Number.isFinite(loaded.analysis.loudness.integrated) && Number.isFinite(loaded.analysis.truePeak.dbtp));
    t.ok('pcm balasan identik dengan sumber', S.maxAbsDiff(src, loaded.pcm) === 0);
  }
  planMsg = of(h.send({ type: 'plan', opts: OPTS }), 'plan')[0];
  t.ok('worker membalas "plan" dengan setting lengkap', !!planMsg && Number.isFinite(planMsg.settings.loud.targetLufs) && Array.isArray(planMsg.actions) && Array.isArray(planMsg.problems));

  const t0 = Date.now(), mm = h.send({ type: 'master', opts: OPTS });
  mastered = of(mm, 'mastered')[0];
  t.ok('worker membalas "mastered"', !!mastered, 'waktu ' + (Date.now() - t0) + ' ms');
  t.ok('ada pesan progress selama render (untuk bar progres UI)', of(mm, 'progress').length >= 8, 'jumlah=' + of(mm, 'progress').length);
  if (mastered) {
    const ceil = mastered.settings.lim.ceilingDb;
    t.ok('pcm hasil finite dan panjang sama', S.allFinite(mastered.pcm) && mastered.pcm[0].length === src[0].length);
    t.near('loudness mendekati target', mastered.analysis.loudness.integrated, mastered.settings.loud.targetLufs, 0.5, ' LUFS');
    t.atMost('true peak <= ceiling', mastered.analysis.truePeak.dbtp, ceil + 0.05, ' dBTP');
    for (const id of ['clip', 'tp', 'int']) t.ok('QC ' + id + ' = pass', (mastered.qc.find((q) => q.id === id) || {}).status === 'pass');
    t.ok('hasil bukan sekadar salinan sumber', S.maxAbsDiff(src, mastered.pcm) > 0.01);
  }
  const again = of(h.send({ type: 'master', opts: OPTS }), 'mastered')[0];
  t.ok('tombol Re-master: render kedua bit identik dengan yang pertama', !!again && !!mastered && S.md5(again.pcm) === S.md5(mastered.pcm));
}

t.section('chain yang diedit (Advanced) dan tombol Re-master');
if (planMsg) {
  const edited = JSON.parse(JSON.stringify(planMsg.settings));
  edited.comp.bypass = true; edited.mb.bypass = true;
  const m = of(h.send({ type: 'master', opts: OPTS, settings: edited }), 'mastered')[0];
  t.ok('worker menerima setting hasil edit', !!m && m.edited === true);
  if (m) {
    t.ok('tahap yang di-bypass benar-benar dilewati (laporan)', m.report.stages.comp.bypassed === true && m.report.stages.mb.bypassed === true);
    t.ok('hasil edit berbeda dari hasil preset', !!mastered && S.md5(m.pcm) !== S.md5(mastered.pcm));
    t.atMost('true peak tetap <= ceiling setelah edit', m.analysis.truePeak.dbtp, edited.lim.ceilingDb + 0.05, ' dBTP');
  }
  h.send({ type: 'master', opts: OPTS });
}

t.section('export lewat worker (opsi persis seperti UI)');
{
  const UI = [
    { format: 'wav', bits: 24, sampleRate: 0, dither: 'auto', ceilingDb: -1, ext: 'RIFF' },
    { format: 'wav', bits: 16, sampleRate: 44100, dither: 'shaped', ceilingDb: -1, ext: 'RIFF' },
    { format: 'wav', bits: 32, sampleRate: 96000, dither: 'auto', ceilingDb: -1, ext: 'RIFF' },
    { format: 'flac', bits: 24, sampleRate: 0, dither: 'auto', ceilingDb: -1, ext: 'fLaC' },
    { format: 'flac', bits: 16, sampleRate: 88200, dither: 'tpdf', ceilingDb: -1, ext: 'fLaC' },
  ];
  for (const o of UI) {
    const label = o.format.toUpperCase() + ' ' + o.bits + ' @' + (o.sampleRate || 'asli');
    const e = of(h.send({ type: 'export', opts: o }), 'exported')[0];
    t.ok(label + ': worker membalas "exported" dan lulus verifikasi', !!e && e.ok === true, e ? JSON.stringify(e.checks.filter((c) => !c.ok)) : 'tidak ada balasan');
    if (e) {
      t.ok(label + ': header file benar', ascii(e.bytes, 0, 4) === o.ext);
      t.ok(label + ': sample rate sesuai pilihan', e.fs === (o.sampleRate || FS));
    }
  }
}

t.section('decode format file lewat worker (WAV, FLAC, AIFF)');
{
  const x = S.music(44100, 2, { peakDb: -6 });
  const w16 = quantize(x, 16, 'none', 44100).ints, f24 = quantize(x, 24, 'none', 44100).ints;
  const files = [
    ['WAV 16-bit', encodeWav(w16, 44100, 16, false), 1 / 32768],
    ['WAV 24-bit', encodeWav(f24, 44100, 24, false), 1 / 8388608],
    ['WAV 32-bit float', encodeWav(x, 44100, 32, true), 0],
    ['FLAC 24-bit', encodeFlac(f24, 44100, 24), 1 / 8388608],
    ['AIFF 16-bit', makeAiff(x, 44100, 16), 1 / 32768],
    ['AIFF 24-bit', makeAiff(x, 44100, 24), 1 / 8388608],
  ];
  for (const [label, bytes, tol] of files) {
    const hh = fresh(), buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const msgs = hh.send({ type: 'decode', buffer: buf, name: label + '.bin' }), l = of(msgs, 'loaded')[0], err = of(msgs, 'error')[0];
    t.ok(label + ': ter-decode', !!l, err ? err.message : '');
    if (l) {
      t.ok(label + ': sample rate, kanal, panjang benar', l.info.fs === 44100 && l.info.channels === 2 && l.info.frames === x[0].length, l.info.fs + ' Hz ' + l.info.channels + ' ch ' + l.info.frames + ' frame');
      t.atMost(label + ': isi audio cocok dengan aslinya', S.maxAbsDiff(x, l.pcm), tol + 1e-6);
    }
  }
}

t.section('berkas multikanal');
{
  const hh = fresh(), six = [S.sine(FS, 1, 220, -12, 1)[0], S.sine(FS, 1, 330, -12, 1)[0], S.sine(FS, 1, 440, -12, 1)[0]];
  const l = of(hh.send({ type: 'pcm', chans: six, fs: FS, info: { name: '3ch' } }), 'loaded')[0];
  t.ok('3 kanal: dua kanal pertama dipakai dan ada catatan untuk pengguna', !!l && l.info.channels === 2 && /Multichannel/i.test(l.info.note || ''), l ? l.info.note : '');
}

t.done();
