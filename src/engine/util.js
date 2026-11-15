// util.js — shared numeric helpers (pure functions, no DOM)
export function dbToLin(db) { return Math.pow(10, db / 20); }
export function linToDb(x) { return x > 1e-30 ? 20 * Math.log10(x) : -600; }
export function powToDb(p) { return p > 1e-60 ? 10 * Math.log10(p) : -600; }
export function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
export function tcCoef(ms, fs) { return ms > 0 ? Math.exp(-1 / (ms * 0.001 * fs)) : 0; }
export function percentileOf(values, p) {
  const a = Float64Array.from(values).sort(); if (!a.length) return NaN;
  const idx = clamp((a.length - 1) * p, 0, a.length - 1), lo = Math.floor(idx), hi = Math.ceil(idx);
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}
// mulberry32: deterministic PRNG -> repeatable dither and renders
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function cloneDeep(o) { return JSON.parse(JSON.stringify(o)); }
export function mergeDeep(target, src) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) mergeDeep(target[k], v);
    else target[k] = (v && typeof v === 'object') ? cloneDeep(v) : v;
  }
  return target;
}
export function besselI0(x) { let s = 1, t = 1; for (let k = 1; k < 60; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; if (t < 1e-14 * s) break; } return s; }
export function kaiserWin(u, beta) { const a = 1 - u * u; return a <= 0 ? 0 : besselI0(beta * Math.sqrt(a)) / besselI0(beta); }
export function sinc(x) { if (Math.abs(x) < 1e-12) return 1; const px = Math.PI * x; return Math.sin(px) / px; }
// Lambert continued-fraction tanh approximation (|err| < 2e-5), clamped and monotonic
export function fastTanh(x) {
  if (x > 4.9) return 1; if (x < -4.9) return -1;
  const x2 = x * x, y = x * (135135 + x2 * (17325 + x2 * (378 + x2))) / (135135 + x2 * (62370 + x2 * (3150 + x2 * 28)));
  return y > 1 ? 1 : (y < -1 ? -1 : y);
}
// gated percentile of block levels (dB): absolute gate + relative gate below the power mean
export function gatedPercentile(levelsDb, p, relGate = -20, absGate = -70) {
  let sum = 0, n = 0;
  for (const v of levelsDb) if (v > absGate) { sum += Math.pow(10, v / 10); n++; }
  if (!n) return NaN;
  const thr = 10 * Math.log10(sum / n) + relGate, sel = [];
  for (const v of levelsDb) if (v > absGate && v > thr) sel.push(v);
  return percentileOf(sel, p);
}
export class DelayLine {
  constructor(d) { this.d = d | 0; this.buf = new Float64Array(Math.max(1, this.d)); this.i = 0; }
  process(x, n) {
    if (!this.d) return; const b = this.buf, d = this.d; let i = this.i;
    for (let k = 0; k < n; k++) { const v = b[i]; b[i] = x[k]; x[k] = v; if (++i === d) i = 0; }
    this.i = i;
  }
}
