// fft.js — iterative radix-2 complex FFT (in place, separate re/im arrays)
export function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }
export class FFT {
  constructor(n) {
    this.n = n; const lv = Math.round(Math.log2(n)); if ((1 << lv) !== n) throw new Error('FFT size must be a power of 2');
    this.cos = new Float64Array(n >> 1); this.sin = new Float64Array(n >> 1);
    for (let i = 0; i < n >> 1; i++) { this.cos[i] = Math.cos(2 * Math.PI * i / n); this.sin[i] = Math.sin(2 * Math.PI * i / n); }
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) { let r = 0, x = i; for (let b = 0; b < lv; b++) { r = (r << 1) | (x & 1); x >>= 1; } this.rev[i] = r; }
  }
  transform(re, im, inverse = false) {
    const n = this.n, rev = this.rev, cs = this.cos, sn = this.sin, sg = inverse ? 1 : -1;
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half, wr = cs[k], wi = sg * sn[k];
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
    if (inverse) { const s = 1 / n; for (let i = 0; i < n; i++) { re[i] *= s; im[i] *= s; } }
  }
}
