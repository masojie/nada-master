// oversample.js — linear-phase halfband cascade oversampler (2x/4x/8x) and true-peak interpolator
import { kaiserWin, sinc } from './util.js';
function designHalfband(M, beta) { // nonzero taps at odd offsets 1,3,..,2M-1 ; g[j] = 2*h[c+2j+1]
  const c = 2 * M - 1, g = new Float64Array(M); let s = 0;
  for (let j = 0; j < M; j++) { const o = 2 * j + 1; g[j] = sinc(o / 2) * kaiserWin(o / (c + 1), beta); s += 2 * g[j]; }
  for (let j = 0; j < M; j++) g[j] /= s;
  return g;
}
class HB2x {
  constructor(M, beta) { this.M = M; this.g = designHalfband(M, beta); this.uh = new Float64Array(2 * M); this.dh = new Float64Array(4 * M); this.ub = new Float64Array(0); this.db = new Float64Array(0); }
  up(x, n, y) {
    const M = this.M, g = this.g, L = 2 * M;
    if (this.ub.length < L + n) this.ub = new Float64Array(L + n);
    const b = this.ub; b.set(this.uh); for (let i = 0; i < n; i++) b[L + i] = x[i];
    for (let m = 0; m < n; m++) {
      const p = L + m; let acc = 0;
      for (let j = 0; j < M; j++) acc += g[j] * (b[p - M - j] + b[p - M + 1 + j]);
      y[2 * m] = acc; y[2 * m + 1] = b[p - M + 1];
    }
    for (let i = 0; i < L; i++) this.uh[i] = b[n + i];
  }
  down(v, n, z) { // v holds 2n samples
    const M = this.M, g = this.g, L = 4 * M;
    if (this.db.length < L + 2 * n) this.db = new Float64Array(L + 2 * n);
    const b = this.db; b.set(this.dh); for (let i = 0; i < 2 * n; i++) b[L + i] = v[i];
    for (let m = 0; m < n; m++) {
      const p = L + 2 * m; let acc = 0;
      for (let j = 0; j < M; j++) acc += g[j] * (b[p - 2 * M - 2 * j] + b[p - 2 * M + 2 + 2 * j]);
      z[m] = 0.5 * b[p - 2 * M + 1] + 0.5 * acc;
    }
    for (let i = 0; i < L; i++) this.dh[i] = b[2 * n + i];
  }
}
// one instance per channel; latency is an integer number of base-rate samples
export class Oversampler {
  constructor(factor) {
    this.F = factor >= 8 ? 8 : factor >= 4 ? 4 : factor >= 2 ? 2 : 1;
    const specs = { 1: [], 2: [[24, 9]], 4: [[24, 9], [7, 9]], 8: [[24, 9], [7, 9], [5, 8]] }[this.F];
    this.stages = specs.map(([M, b]) => new HB2x(M, b));
    const S = specs.length; let D = 0;
    specs.forEach(([M], i) => { D += (4 * M - 2) * (1 << (S - 1 - i)); });
    this.pad = this.F > 1 ? (this.F - (D % this.F)) % this.F : 0;
    this.latency = this.F > 1 ? (D + this.pad) / this.F : 0;
    this.padBuf = new Float64Array(Math.max(1, this.pad)); this.padI = 0; this.tmp = [];
  }
  _t(i, len) { if (!this.tmp[i] || this.tmp[i].length < len) this.tmp[i] = new Float64Array(len); return this.tmp[i]; }
  up(x, n, out) {
    if (this.F === 1) { for (let i = 0; i < n; i++) out[i] = x[i]; return; }
    let cur = x, len = n; const S = this.stages.length;
    for (let s = 0; s < S; s++) { const dst = s === S - 1 ? out : this._t(s, len * 2); this.stages[s].up(cur, len, dst); cur = dst; len *= 2; }
    if (this.pad) { const pb = this.padBuf, P = this.pad; let k = this.padI; for (let i = 0; i < len; i++) { const v = pb[k]; pb[k] = out[i]; out[i] = v; if (++k === P) k = 0; } this.padI = k; }
  }
  down(v, n, out) {
    if (this.F === 1) { for (let i = 0; i < n; i++) out[i] = v[i]; return; }
    let cur = v, len = n * this.F;
    for (let s = this.stages.length - 1; s >= 0; s--) { const dst = s === 0 ? out : this._t(8 + s, len / 2); this.stages[s].down(cur, len / 2, dst); cur = dst; len /= 2; }
  }
}
// True-peak interpolator: windowed-sinc polyphase, 48 taps per phase (Kaiser beta 8). segMax[i] = max |x| over [i, i+1) incl. interpolated points.
// 4x below 120 kHz and 2x above (BS.1770-4 asks for an effective rate of at least 192 kHz). The former 16-tap kernel under-read
// HF-dense material by up to 1.3 dB.
export function tpFactorFor(fs) { return fs < 120000 ? 4 : 2; }
function tpPhases(F, taps, beta) {
  const h = taps >> 1, ph = [];
  for (let p = 1; p < F; p++) { const u = p / F, c = new Float64Array(taps); let s = 0; for (let j = 0; j < taps; j++) { const t = u - (j - (h - 1)); c[j] = sinc(t) * kaiserWin(t / h, beta); s += c[j]; } for (let j = 0; j < taps; j++) c[j] /= s; ph.push(c); }
  return ph;
}
// Buffer kerja untuk pass limiter/true-peak yang diulang (pencarian loudness). Tanpa `sc` tiap panggilan mengalokasi sendiri seperti dulu.
// seg tidak dibersihkan di sini: pemanggil yang mengakumulasi ke seg wajib memanggil seg.fill(0).
export function tpScratch(sc, N, F, needTmp) {
  const s = sc || {};
  if (!s.seg || s.seg.length !== N) s.seg = new Float32Array(N);
  if (needTmp && (!s.tmp || s.tmp.length !== N)) s.tmp = new Float32Array(N);
  if (!s.tp || s.F !== F) { s.tp = new TPInterp(F); s.F = F; }
  return s;
}
export class TPInterp {
  constructor(factor, taps = 48, beta = 8) {
    this.F = factor; this.T = taps; this.h = taps >> 1; this.ph = tpPhases(factor, taps, beta);
    // cheap 16-tap pre-pass plus the rigorous bound |y_long - y_short| <= D * max|x| over the long kernel support
    this.cs = taps > 16 && factor > 1 ? tpPhases(factor, 16, 6.5) : null; this.D = 0;
    if (this.cs) for (let p = 0; p < this.ph.length; p++) { let d = 0; const a = this.ph[p], b = this.cs[p], off = this.h - 8; for (let j = 0; j < taps; j++) { const k = j - off; d += Math.abs(a[j] - (k >= 0 && k < 16 ? b[k] : 0)); } if (d > this.D) this.D = d; }
  }
  _run(x, out, P, T, h, i0, i1) {
    const N = x.length, np = P.length, lo = h - 1, hi = N - h;
    for (let i = i0; i < i1; i++) {
      let m = Math.abs(x[i]); const base = i - h + 1;
      if (i >= lo && i < hi) {
        for (let p = 0; p < np; p++) { const c = P[p]; let a = 0; for (let j = 0; j < T; j++) a += c[j] * x[base + j]; if (a < 0) a = -a; if (a > m) m = a; }
      } else {
        for (let p = 0; p < np; p++) { const c = P[p]; let a = 0; for (let j = 0; j < T; j++) { const k = base + j; if (k >= 0 && k < N) a += c[j] * x[k]; } if (a < 0) a = -a; if (a > m) m = a; }
      }
      out[i] = m;
    }
  }
  // thr > 0: every value that can reach thr is computed exactly with the long kernel; the others stay at the cheap estimate (provably < thr)
  segMax(x, out, thr = 0) {
    const N = x.length;
    if (!this.ph.length) { for (let i = 0; i < N; i++) out[i] = Math.abs(x[i]); return; }
    if (!this.cs || !(thr > 0)) { this._run(x, out, this.ph, this.T, this.h, 0, N); return; }
    this._run(x, out, this.cs, 16, 8, 0, N);
    // deque indeks dipakai ulang antar panggilan: isinya selalu ditulis sebelum dibaca, jadi hasil identik
    if (!this._dq || this._dq.length < N) this._dq = new Int32Array(N);
    const h = this.h, D = this.D, dq = this._dq; let hd = 0, tl = 0;
    for (let i = -h; i < N; i++) {
      const add = i + h; if (add < N) { const v = Math.abs(x[add]); while (tl > hd && Math.abs(x[dq[tl - 1]]) <= v) tl--; dq[tl++] = add; }
      if (i < 0) continue; while (dq[hd] < i - h + 1) hd++;
      if (out[i] + D * Math.abs(x[dq[hd]]) >= thr) this._run(x, out, this.ph, this.T, h, i, i + 1);
    }
  }
}
