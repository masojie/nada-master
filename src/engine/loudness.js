// loudness.js — ITU-R BS.1770-4 / EBU R128 loudness (Integrated, Momentary, Short-term, LRA) and true peak
import { Biquads } from './biquad.js';
import { tpScratch, tpFactorFor } from './oversample.js';
import { percentileOf } from './util.js';
export function kWeightingSections(fs) { // analog-prototype formulas (libebur128), valid for any sample rate
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196, K = Math.tan(Math.PI * f0 / fs);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416); let a0 = 1 + K / Q + K * K;
  const pre = { b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / fs); a0 = 1 + K / Q + K * K;
  return [pre, { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 }];
}
const LK = (e) => -0.691 + 10 * Math.log10(e + 1e-30);
export function hopEnergies(chans, fs) {
  const N = chans[0].length, hop = Math.max(1, Math.round(fs / 10)), nHop = Math.max(1, Math.ceil(N / hop));
  const e = new Float64Array(nHop), cnt = new Float64Array(nHop), blk = new Float64Array(hop), ks = kWeightingSections(fs);
  for (let c = 0; c < chans.length; c++) {
    const bq = new Biquads(ks, 1), x = chans[c];
    for (let h = 0; h < nHop; h++) {
      const off = h * hop, len = Math.min(hop, N - off); if (len <= 0) break;
      for (let i = 0; i < len; i++) blk[i] = x[off + i];
      bq.run(blk, len, 0);
      let s = 0; for (let i = 0; i < len; i++) s += blk[i] * blk[i];
      e[h] += s; if (c === 0) cnt[h] = len;
    }
  }
  return { e, cnt, hop };
}
export function loudnessFromHops({ e, cnt, hop }) {
  const nHop = e.length, mom = new Float32Array(nHop), st = new Float32Array(nHop), blocks = [], stE = [];
  for (let h = 0; h < nHop; h++) {
    let s4 = 0, c4 = 0, s30 = 0, c30 = 0;
    for (let k = Math.max(0, h - 3); k <= h; k++) { s4 += e[k]; c4 += cnt[k]; }
    for (let k = Math.max(0, h - 29); k <= h; k++) { s30 += e[k]; c30 += cnt[k]; }
    const em = c4 ? s4 / c4 : 0, es = c30 ? s30 / c30 : 0;
    mom[h] = Math.max(-120, LK(em)); st[h] = Math.max(-120, LK(es));
    if (h >= 3 && c4 === 4 * hop) blocks.push(em);
    if (h >= 29 && c30 === 30 * hop) stE.push(es);
  }
  let integrated = -Infinity;
  if (!blocks.length) { let s = 0, c = 0; for (let h = 0; h < nHop; h++) { s += e[h]; c += cnt[h]; } if (c && LK(s / c) > -70) integrated = LK(s / c); }
  else {
    const ag = blocks.filter((v) => LK(v) > -70);
    if (ag.length) { const rel = LK(ag.reduce((a, b) => a + b, 0) / ag.length) - 10, g = ag.filter((v) => LK(v) > rel); integrated = LK(g.reduce((a, b) => a + b, 0) / g.length); }
  }
  let lra = 0; const sg = stE.filter((v) => LK(v) > -70);
  if (sg.length > 1) { const rel = LK(sg.reduce((a, b) => a + b, 0) / sg.length) - 20, vals = sg.filter((v) => LK(v) > rel).map(LK); if (vals.length > 1) lra = percentileOf(vals, 0.95) - percentileOf(vals, 0.10); }
  let maxM = -120, maxS = -120;
  for (let h = 0; h < nHop; h++) { if ((h >= 3 || nHop < 4) && mom[h] > maxM) maxM = mom[h]; if ((h >= 29 || nHop < 30) && st[h] > maxS) maxS = st[h]; }
  return { integrated, lra, maxMomentary: maxM, maxShortTerm: maxS, momentary: mom, shortTerm: st };
}
export function measureLoudness(chans, fs) { return loudnessFromHops(hopEnergies(chans, fs)); }
export function integratedLufs(chans, fs) { return measureLoudness(chans, fs).integrated; }
// overall and per-channel values are exact; the per-hop display series may use the cheap estimate below the channel's sample peak
export function measureTruePeak(chans, fs, hop = 0, scratch = null) {
  const F = tpFactorFor(fs), N = chans[0].length, sc = tpScratch(scratch, N, F, false), tp = sc.tp, seg = sc.seg;
  const nHop = hop ? Math.ceil(N / hop) : 0, series = hop ? new Float32Array(nHop) : null, perCh = [];
  let mx = 0;
  for (const x of chans) {
    let sp = 0; for (let i = 0; i < N; i++) { const a = x[i] < 0 ? -x[i] : x[i]; if (a > sp) sp = a; }
    if (sp > 0) tp.segMax(x, seg, sp); else seg.fill(0);
    let m = 0;
    for (let i = 0; i < N; i++) { const v = seg[i]; if (v > m) m = v; if (series) { const k = (i / hop) | 0; if (v > series[k]) series[k] = v; } }
    perCh.push(m); if (m > mx) mx = m;
  }
  const tdb = (v) => (v > 1e-30 ? 20 * Math.log10(v) : -600);
  if (series) for (let k = 0; k < nHop; k++) series[k] = Math.max(-120, tdb(series[k]));
  return { dbtp: tdb(mx), lin: mx, perChannelDb: perCh.map(tdb), series, factor: F };
}
