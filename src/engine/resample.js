// resample.js — high-quality band-limited sample-rate conversion: Kaiser-windowed sinc, exact rational polyphase table.
// Passband to min(20 kHz, 0.9 x Nyquist_min), stopband from Nyquist_min, ~95 dB rejection.
import { sinc, kaiserWin } from './util.js';
function gcd(a, b) { while (b) { const t = a % b; a = b; b = t; } return a; }
export function resample(chans, fsIn, fsOut, atten = 95) {
  if (fsIn === fsOut) return chans.map((c) => new Float32Array(c));
  const g = gcd(fsIn, fsOut), Lr = fsOut / g, Mr = fsIn / g; if (Lr > 4096) throw new Error('Unsupported resampling ratio ' + fsIn + '->' + fsOut);
  const nyq = 0.5 * Math.min(fsIn, fsOut), pass = Math.min(20000, 0.9 * nyq), stop = nyq;
  const fc = (pass + stop) / 2 / fsIn, df = (stop - pass) / fsIn, beta = 0.1102 * (atten - 8.7);
  const half = Math.ceil((atten - 8) / (2.285 * 2 * Math.PI * df) / 2) + 1, T = 2 * half, coef = new Float64Array(Lr * T);
  for (let ph = 0; ph < Lr; ph++) { const frac = ph / Lr; let s = 0;
    for (let j = 0; j < T; j++) { const d = frac - (j - (half - 1)), v = 2 * fc * sinc(2 * fc * d) * kaiserWin(d / half, beta); coef[ph * T + j] = v; s += v; }
    for (let j = 0; j < T; j++) coef[ph * T + j] /= s; }
  return chans.map((x) => {
    const N = x.length, No = Math.floor(N * Lr / Mr), y = new Float32Array(No); let i0 = 0, ph = 0;
    for (let n = 0; n < No; n++) {
      const base = i0 - (half - 1), o = ph * T; let acc = 0;
      if (base >= 0 && base + T <= N) for (let j = 0; j < T; j++) acc += coef[o + j] * x[base + j];
      else for (let j = 0; j < T; j++) { const k = base + j; if (k >= 0 && k < N) acc += coef[o + j] * x[k]; }
      y[n] = acc; ph += Mr; while (ph >= Lr) { ph -= Lr; i0++; }
    }
    return y;
  });
}
