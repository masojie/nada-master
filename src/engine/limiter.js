// limiter.js — offline true-peak lookahead brickwall limiter.
// gain[n] <= ceiling / truePeak(n) is guaranteed by: forward min-hold over the lookahead window, causal moving
// averages whose total span <= lookahead (each averaged term already covers sample n), and a release envelope
// that follows downward moves instantly. A slow second envelope (auto release) reduces pumping on sustained limiting.
import { tpScratch, tpFactorFor } from './oversample.js';
import { dbToLin, tcCoef } from './util.js';
function minHoldForward(g, out, L) {
  const N = g.length, cap = L + 2, dq = new Int32Array(cap); let head = 0, size = 0;
  for (let n = N - 1; n >= 0; n--) {
    const v = g[n];
    while (size > 0 && g[dq[(head + size - 1) % cap]] >= v) size--;
    dq[(head + size) % cap] = n; size++;
    while (dq[head] > n + L) { head = (head + 1) % cap; size--; }
    out[n] = g[dq[head]];
  }
}
function movingAvg(a, len, pad) {
  if (len <= 1) return; const ring = new Float64Array(len).fill(pad); let sum = pad * len, k = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i]; sum += v - ring[k]; ring[k] = v; if (++k === len) { k = 0; let s = 0; for (let j = 0; j < len; j++) s += ring[j]; sum = s; }
    a[i] = sum / len;
  }
}
export const LIM_STYLES = { transparent: { slow: 5, double: true }, balanced: { slow: 3, double: true }, punchy: { slow: 2, double: false } };
export function runLimiter(chans, p, fs, opts = {}) {
  const N = chans[0].length, ceil = dbToLin(p.ceilingDb - 0.02 - (opts.marginDb || 0));
  const F = p.tpDetect === false ? 1 : tpFactorFor(fs), sc = tpScratch(opts.scratch, N, F, true), tp = sc.tp, seg = sc.seg, tmp = sc.tmp;
  seg.fill(0); // scratch dipakai ulang antar pass; tmp ditimpa penuh oleh segMax
  for (const x of chans) { tp.segMax(x, tmp, ceil); for (let i = 0; i < N; i++) if (tmp[i] > seg[i]) seg[i] = tmp[i]; }
  const g = tmp; let prev = 0;
  for (let i = 0; i < N; i++) { const s = seg[i], pk = s > prev ? s : prev; prev = s; g[i] = pk > ceil ? ceil / pk : 1; }
  const L = Math.max(1, Math.round((p.lookaheadMs || 3) * 0.001 * fs)), st = LIM_STYLES[p.style] || LIM_STYLES.balanced;
  minHoldForward(g, seg, L);
  if (st.double) { const L1 = (L >> 1) + 1, L2 = L + 2 - L1; movingAvg(seg, L1, seg[0]); movingAvg(seg, L2, seg[0]); } else movingAvg(seg, L + 1, seg[0]);
  const aR = tcCoef(p.releaseMs || 100, fs), auto = p.autoRelease !== false, aSA = tcCoef(80, fs), aSR = tcCoef((p.releaseMs || 100) * st.slow, fs);
  const hop = Math.max(1, Math.round(fs / 10)), nHop = Math.ceil(N / hop), grSeries = new Float32Array(nHop);
  let eF = 0, eS = 0, maxGr = 0, sumGr = 0, over1 = 0, over3 = 0, clamps = 0;
  for (let i = 0; i < N; i++) {
    const s = seg[i], sDb = s < 1 ? 20 * Math.log10(s) : 0;
    eF = sDb < eF ? sDb : sDb + (eF - sDb) * aR; let e = eF;
    if (auto) { eS = sDb < eS ? sDb + (eS - sDb) * aSA : sDb + (eS - sDb) * aSR; if (eS < e) e = eS; }
    seg[i] = e < -1e-6 ? Math.pow(10, e / 20) : 1;
    if (e < maxGr) maxGr = e; sumGr += e; if (e < -1) over1++; if (e < -3) over3++;
    const k = (i / hop) | 0; if (e < grSeries[k]) grSeries[k] = e;
  }
  for (const x of chans) for (let i = 0; i < N; i++) { let v = x[i] * seg[i]; if (v > ceil) { v = ceil; clamps++; } else if (v < -ceil) { v = -ceil; clamps++; } x[i] = v; }
  return { maxGrDb: +maxGr.toFixed(2), avgGrDb: +(sumGr / Math.max(1, N)).toFixed(3), pctOver1dB: +(100 * over1 / N).toFixed(2), pctOver3dB: +(100 * over3 / N).toFixed(2), safetyClamps: clamps, grSeries, lookaheadSamples: L, tpFactor: F };
}
