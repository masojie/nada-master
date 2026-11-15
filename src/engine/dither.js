// dither.js — TPDF dither + psychoacoustic noise shaping (error feedback) for 16/24-bit quantisation
import { makeRng } from './util.js';
// Lipshitz minimally-audible 5-tap noise-shaping filter (designed for 44.1/48 kHz)
const SHAPE_LIP5 = [2.033, -2.165, 1.959, -1.590, 0.6149];
export function resolveDither(type, bits, fs) {
  if (bits >= 32 || type === 'none') return 'none';
  if (type === 'auto') return (bits === 16 && (fs === 44100 || fs === 48000)) ? 'shaped' : 'tpdf';
  if (type === 'shaped' && !(fs === 44100 || fs === 48000)) return 'tpdf';
  return type;
}
export function quantize(chans, bits, type, fs, seed = 0x5EED) {
  const mode = resolveDither(type, bits, fs), scale = Math.pow(2, bits - 1), maxI = scale - 1, minI = -scale, rng = makeRng(seed);
  const h = mode === 'shaped' ? SHAPE_LIP5 : null, K = h ? h.length : 0; let clipped = 0;
  const ints = chans.map((x) => {
    const N = x.length, y = new Int32Array(N), e = new Float64Array(8); let ei = 0;
    for (let i = 0; i < N; i++) {
      let u = x[i] * scale;
      if (h) { let fb = 0; for (let k = 0; k < K; k++) fb += h[k] * e[(ei - k + 8) & 7]; u -= fb; }
      const d = mode === 'none' ? 0 : (rng() - rng());
      let q = Math.round(u + d); if (q > maxI) { q = maxI; clipped++; } else if (q < minI) { q = minI; clipped++; }
      if (h) { ei = (ei + 1) & 7; e[ei] = q - u; }
      y[i] = q;
    }
    return y;
  });
  return { ints, mode, clipped };
}
