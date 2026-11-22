// exporter.js — optional HQ resampling (+ true-peak safety limiter), dither/noise shaping, WAV/FLAC encoding and verification
import { resample } from './resample.js';
import { runLimiter } from './limiter.js';
import { quantize } from './dither.js';
import { encodeWav, decodeWav } from './codecs.js';
import { encodeFlac, decodeFlac } from './flac.js';
import { measureTruePeak } from './loudness.js';
export function exportAudio(chans, fs, o) {
  const t = Date.now(), outFs = o.sampleRate && o.sampleRate !== fs ? o.sampleRate : fs, checks = [], ceil = o.ceilingDb ?? -1; let data = chans, safety = null;
  if (outFs !== fs) { data = resample(chans, fs, outFs); safety = runLimiter(data, { ceilingDb: ceil, lookaheadMs: 1.5, releaseMs: 50, autoRelease: false, style: 'balanced', tpDetect: true }, outFs); }
  let bytes, ints = null, mode = 'none', clipped = 0;
  if (o.format === 'wav' && o.bits === 32) bytes = encodeWav(data, outFs, 32, true);
  else { const q = quantize(data, o.bits, o.dither || 'auto', outFs, o.seed ?? 0x5EED); ints = q.ints; mode = q.mode; clipped = q.clipped; bytes = o.format === 'flac' ? encodeFlac(ints, outFs, o.bits) : encodeWav(ints, outFs, o.bits, false); }
  const back = o.format === 'flac' ? decodeFlac(bytes) : decodeWav(bytes); let mism = 0;
  if (ints) { const sc = Math.pow(2, o.bits - 1); for (let c = 0; c < ints.length; c++) { const a = ints[c], b = back.ints ? back.ints[c] : null, f = back.chans[c]; for (let i = 0; i < a.length; i++) if ((b ? b[i] : Math.round(f[i] * sc)) !== a[i]) mism++; } }
  else for (let c = 0; c < data.length; c++) for (let i = 0; i < data[c].length; i++) if (back.chans[c][i] !== data[c][i]) mism++;
  const tp = measureTruePeak(back.chans, back.fs).dbtp;
  checks.push({ title: 'Decoded back & compared', ok: mism === 0, value: mism === 0 ? 'bit-exact' : mism + ' mismatches' });
  checks.push({ title: 'Format', ok: back.fs === outFs && back.chans.length === chans.length && back.info.bitDepth === o.bits, value: `${o.format.toUpperCase()} ${o.bits}-bit${o.bits === 32 ? ' float' : ''} · ${back.fs} Hz · ${back.chans.length} ch` });
  checks.push({ title: 'True peak after quantisation', ok: tp <= ceil + 0.1, value: tp.toFixed(2) + ' dBTP' });
  checks.push({ title: 'Length', ok: back.chans[0].length === data[0].length, value: back.chans[0].length + ' frames' });
  // samples beyond integer full scale are clamped by the quantiser: report them instead of exporting silently clipped audio
  if (ints) checks.push({ title: 'Integer clipping', ok: clipped === 0, value: clipped ? clipped + ' samples clipped to full scale' : 'none' });
  if (back.info.crcErrors) checks.push({ title: 'FLAC CRC', ok: false, value: back.info.crcErrors + ' errors' });
  return { bytes, fs: outFs, dither: mode, safety: safety ? { maxGrDb: safety.maxGrDb } : null, checks, ok: checks.every((c) => c.ok), ms: Date.now() - t };
}
