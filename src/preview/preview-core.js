// preview-core.js: inti jalur preview cepat NADA Master (PROTOTIPE, terpisah dari src/engine).
// Murni JS tanpa DOM dan tanpa Web Audio, jadi bisa dites di Node dan dijalankan di AudioWorklet.
// Aturan keras: process() tidak boleh membuat objek, array, atau closure baru. Semua buffer dibuat sekali di constructor.
// Tahap: Pre (gain + rumble HPF), EQ minimum-phase (L/R, mid-only, side-only), kompresor bus, limiter lookahead (sample-peak).
export const MAXS = 12;
export const MAXM = 4;
export const MAXD = 4;
const CAP = 2048, TAU = 0.012;
const tc = (ms, fs) => (ms > 0 ? Math.exp(-1 / (ms * 0.001 * fs)) : 0);
const dbl = (db) => Math.pow(10, db / 20);
function gcDb(x, T, R, W) { const d = x - T; if (2 * d < -W) return 0; if (W > 0 && 2 * Math.abs(d) <= W) { const t = d + W / 2; return (1 / R - 1) * t * t / (2 * W); } return (1 / R - 1) * d; }

// Kumpulan biquad (transposed DF2, state Float64). Koefisien bergerak ke target dengan interpolasi LINEAR per sampel di dalam blok,
// jadi lompatan knob (atau ganti preset) tidak menjadi klik di batas blok.
class Bank {
  constructor(n, nch) {
    this.n = n; this.nch = nch; this.c = new Float64Array(5 * n); this.t = new Float64Array(5 * n); this.e = new Float64Array(5 * n); this.d = new Float64Array(5 * n);
    this.z = new Float64Array(2 * n * nch); this.act = new Uint8Array(n); this.rmp = new Uint8Array(n); this.any = false;
    for (let i = 0; i < n; i++) { this.c[5 * i] = 1; this.t[5 * i] = 1; this.e[5 * i] = 1; }
  }
  set(i, co) { const t = this.t, o = 5 * i; if (co) { t[o] = co[0]; t[o + 1] = co[1]; t[o + 2] = co[2]; t[o + 3] = co[3]; t[o + 4] = co[4]; } else { t[o] = 1; t[o + 1] = 0; t[o + 2] = 0; t[o + 3] = 0; t[o + 4] = 0; } }
  settle() { this.c.set(this.t); this.step(1, 1); this.apply(); }
  // hitung koefisien akhir blok (e) dan delta per sampel (d); k = laju pendekatan ke target
  step(k, n) {
    const c = this.c, t = this.t, e = this.e, d = this.d; let any = false;
    for (let i = 0; i < this.n; i++) {
      const o = 5 * i; let rmp = 0, idn = 1;
      for (let j = 0; j < 5; j++) {
        const df = t[o + j] - c[o + j]; let nx;
        if (df > 1e-10 || df < -1e-10) { nx = c[o + j] + df * k; rmp = 1; } else nx = t[o + j];
        e[o + j] = nx; d[o + j] = (nx - c[o + j]) / n;
        if (c[o + j] !== (j === 0 ? 1 : 0) || nx !== (j === 0 ? 1 : 0)) idn = 0;
      }
      const on = idn ? 0 : 1;
      if (!on && this.act[i]) for (let ch = 0; ch < this.nch; ch++) { this.z[2 * (i * this.nch + ch)] = 0; this.z[2 * (i * this.nch + ch) + 1] = 0; }
      this.act[i] = on; this.rmp[i] = rmp; if (on) any = true;
    }
    this.any = any;
  }
  apply() { this.c.set(this.e); }
  run(x, ch, n) {
    if (!this.any) return; const c = this.c, d = this.d, z = this.z;
    for (let k = 0; k < this.n; k++) {
      if (!this.act[k]) continue; const o = 5 * k, zi = 2 * (k * this.nch + ch); let b0 = c[o], b1 = c[o + 1], b2 = c[o + 2], a1 = c[o + 3], a2 = c[o + 4], z1 = z[zi], z2 = z[zi + 1];
      if (this.rmp[k]) {
        const d0 = d[o], d1 = d[o + 1], d2 = d[o + 2], d3 = d[o + 3], d4 = d[o + 4];
        for (let i = 0; i < n; i++) { b0 += d0; b1 += d1; b2 += d2; a1 += d3; a2 += d4; const xi = x[i], y = b0 * xi + z1; z1 = b1 * xi - a1 * y + z2; z2 = b2 * xi - a2 * y; x[i] = y; }
      } else for (let i = 0; i < n; i++) { const xi = x[i], y = b0 * xi + z1; z1 = b1 * xi - a1 * y + z2; z2 = b2 * xi - a2 * y; x[i] = y; }
      if (z1 < 1e-30 && z1 > -1e-30) z1 = 0; if (z2 < 1e-30 && z2 > -1e-30) z2 = 0;
      z[zi] = z1; z[zi + 1] = z2;
    }
  }
  reset() { this.z.fill(0); }
}

export const DEFAULT_PARAMS = {
  preGainDb: 0, rumble: [], eqLR: [], eqMid: [], eqSide: [], outGainDb: 0,
  comp: { bypass: false, thrDb: -20, ratio: 1.8, kneeDb: 6, attackMs: 30, releaseMs: 200, autoRelease: true, rmsMs: 10, scHp: null, mix: 100, makeupDb: 0 },
  lim: { bypass: false, ceilingDb: -1, releaseMs: 100, autoRelease: true, slow: 3 }
};

export class PreviewCore {
  constructor(fs, params, opts = {}) {
    this.fs = fs; this.tau = opts.tau || TAU; this.noSmooth = !!opts.noSmooth; const L = this.L = Math.max(1, Math.round((opts.lookaheadMs || 2) * 0.001 * fs));
    this.pre = new Bank(2, 2); this.eq = new Bank(MAXS, 2); this.mid = new Bank(MAXM, 1); this.side = new Bank(MAXD, 1); this.sc = new Bank(1, 2);
    this.a = new Float64Array(CAP); this.b = new Float64Array(CAP); this.sL = new Float64Array(CAP); this.sR = new Float64Array(CAP);
    // gain yang dihaluskan: sekarang (cur) dan target (tgt)
    this.v = new Float64Array(16); // 0 preG 1 outG 2 cT 3 cR 4 cW 5 cMix 6 cMk 7 limCeil 8 limWet ; target di +8 digeser ke tgt
    this.t = new Float64Array(16);
    // komp
    this.aA = 0; this.aR = 0; this.aSA = 0; this.aSR = 0; this.aRms = 0; this.auto = true; this.ms0 = 0; this.ms1 = 0; this.env = 0; this.envS = 0; this.scOn = false;
    // limiter
    this.cap = L + 2; this.dlL = new Float64Array(L); this.dlR = new Float64Array(L); this.dlC = new Float64Array(L).fill(1); this.dp = 0;
    this.qv = new Float64Array(this.cap); this.qt = new Float64Array(this.cap); this.qh = 0; this.qs = 0; this.tt = 0;
    this.L1 = (L >> 1) + 1; this.L2 = L + 2 - this.L1; this.r1 = new Float64Array(this.L1).fill(1); this.r2 = new Float64Array(this.L2).fill(1);
    this.i1 = 0; this.i2 = 0; this.s1 = this.L1; this.s2 = this.L2; this.eF = 1; this.eS = 1; this.lAuto = true; this.lAR = 0; this.lSA = 0; this.lSR = 0;
    this.mt = new Float64Array(8); this.resetMeters(); this.nan = 0; this.clamps = 0;
    this.setParams(params || DEFAULT_PARAMS); this.settle();
  }
  resetMeters() { this.mt[0] = 0; this.mt[1] = 0; this.mt[2] = 0; this.mt[3] = 1; }
  // meter: [peakL, peakR, grKompDb(<=0), grLimDb(<=0), klamp, nanReset]
  readMeters(out) { const m = this.mt; out[0] = m[0]; out[1] = m[1]; out[2] = m[2]; out[3] = m[3] < 1 ? 20 * Math.log10(m[3]) : 0; out[4] = this.clamps; out[5] = this.nan; this.resetMeters(); }
  setParams(p) {
    const fs = this.fs, t = this.t;
    for (let i = 0; i < 2; i++) this.pre.set(i, p.rumble[i] || null);
    for (let i = 0; i < MAXS; i++) this.eq.set(i, p.eqLR[i] || null);
    for (let i = 0; i < MAXM; i++) this.mid.set(i, p.eqMid[i] || null);
    for (let i = 0; i < MAXD; i++) this.side.set(i, p.eqSide[i] || null);
    const c = p.comp, l = p.lim; this.sc.set(0, c.scHp || null);
    t[0] = dbl(p.preGainDb || 0); t[1] = dbl(p.outGainDb || 0);
    t[2] = c.thrDb; t[3] = Math.max(1, c.ratio); t[4] = Math.max(0, c.kneeDb); t[5] = c.bypass ? 0 : Math.min(1, Math.max(0, c.mix / 100)); t[6] = dbl(c.makeupDb || 0);
    this.auto = !!c.autoRelease; this.aA = tc(c.attackMs, fs); this.aR = tc(c.autoRelease ? c.releaseMs * 0.6 : c.releaseMs, fs);
    this.aSA = tc(Math.max(60, c.attackMs * 4), fs); this.aSR = tc(c.releaseMs * 2.5, fs); this.aRms = tc(Math.max(0.5, c.rmsMs), fs);
    t[7] = dbl(l.ceilingDb - 0.02); t[8] = l.bypass ? 0 : 1;
    this.lAuto = l.autoRelease !== false; this.lAR = tc(l.releaseMs || 100, fs); this.lSA = tc(80, fs); this.lSR = tc((l.releaseMs || 100) * (l.slow || 3), fs);
  }
  settle() { this.v.set(this.t); this.pre.settle(); this.eq.settle(); this.mid.settle(); this.side.settle(); this.sc.settle(); this.env = 0; this.envS = 0; }
  reset() {
    this.pre.reset(); this.eq.reset(); this.mid.reset(); this.side.reset(); this.sc.reset(); this.env = 0; this.envS = 0; this.ms0 = 0; this.ms1 = 0;
    this.dlL.fill(0); this.dlR.fill(0); this.dlC.fill(1); this.qs = 0; this.qh = 0; this.eF = 1; this.eS = 1; this.r1.fill(1); this.r2.fill(1); this.s1 = this.L1; this.s2 = this.L2; this.tt = 0;
  }
  process(inL, inR, outL, outR, n) {
    if (n > CAP) throw new RangeError('blok lebih besar dari CAP; pembungkus harus memecahnya');
    const fs = this.fs, k = 1 - Math.exp(-n / (fs * this.tau)), v = this.v, t = this.t;
    this.pre.step(k, n); this.eq.step(k, n); this.mid.step(k, n); this.side.step(k, n); this.sc.step(k, n);
    if (this.noSmooth) { for (const bk of [this.pre, this.eq, this.mid, this.side, this.sc]) { bk.c.set(bk.t); bk.e.set(bk.t); bk.d.fill(0); bk.rmp.fill(0); } } // hanya kontrol uji: lompatan koefisien tanpa penghalusan
    const A = this.a, B = this.b;
    // Pre: gain (ramp per sampel) + rumble
    const p0 = v[0], p1 = p0 + (t[0] - p0) * k, dp = (p1 - p0) / n; v[0] = p1;
    for (let i = 0; i < n; i++) { const g = p0 + dp * (i + 1); A[i] = inL[i] * g; B[i] = inR[i] * g; }
    this.pre.run(A, 0, n); this.pre.run(B, 1, n);
    this.eq.run(A, 0, n); this.eq.run(B, 1, n);
    if (this.mid.any || this.side.any) {
      const M = this.sL, S = this.sR;
      for (let i = 0; i < n; i++) { M[i] = 0.5 * (A[i] + B[i]); S[i] = 0.5 * (A[i] - B[i]); }
      this.mid.run(M, 0, n); this.side.run(S, 0, n);
      for (let i = 0; i < n; i++) { A[i] = M[i] + S[i]; B[i] = M[i] - S[i]; }
    }
    this.comp(A, B, n, k);
    this.limit(A, B, outL, outR, n, k);
    this.pre.apply(); this.eq.apply(); this.mid.apply(); this.side.apply(); this.sc.apply();
  }
  comp(L, R, n, k) {
    const v = this.v, t = this.t, sL = this.sL, sR = this.sR;
    const T = v[2] += (t[2] - v[2]) * k, Rr = v[3] += (t[3] - v[3]) * k, W = v[4] += (t[4] - v[4]) * k;
    const m0 = v[5], m1 = m0 + (t[5] - m0) * k, dm = (m1 - m0) / n, k0 = v[6], k1 = k0 + (t[6] - k0) * k, dk = (k1 - k0) / n; v[5] = m1; v[6] = k1;
    if (m1 === 0 && m0 === 0 && t[5] === 0) { this.mt[2] = Math.min(this.mt[2], 0); return; }
    for (let i = 0; i < n; i++) { sL[i] = L[i]; sR[i] = R[i]; }
    if (this.sc.any) { this.sc.run(sL, 0, n); this.sc.run(sR, 1, n); }
    const kneeLo = Math.pow(10, (T - W / 2) / 10), aRms = this.aRms, aA = this.aA, aR = this.aR, aSA = this.aSA, aSR = this.aSR, auto = this.auto;
    let mL = this.ms0, mR = this.ms1, env = this.env, envS = this.envS, mn = this.mt[2];
    for (let i = 0; i < n; i++) {
      const a = sL[i] * sL[i]; mL = a + (mL - a) * aRms; const b = sR[i] * sR[i]; mR = b + (mR - b) * aRms; const ms = mR > mL ? mR : mL;
      const tg = ms > kneeLo ? gcDb(10 * Math.log10(ms), T, Rr, W) : 0;
      env = tg < env ? tg + (env - tg) * aA : tg + (env - tg) * aR; let gd = env;
      if (auto) { envS = tg < envS ? tg + (envS - tg) * aSA : tg + (envS - tg) * aSR; if (envS < gd) gd = envS; }
      const mix = m0 + dm * (i + 1), mk = k0 + dk * (i + 1), g = (gd < -0.0005 ? Math.pow(10, gd / 20) : 1) * mk, kk = 1 - mix + mix * g;
      L[i] *= kk; R[i] *= kk; if (gd < mn) mn = gd;
    }
    this.ms0 = mL; this.ms1 = mR; this.env = env; this.envS = envS; this.mt[2] = mn;
  }
  limit(A, B, outL, outR, n, k) {
    const v = this.v, t = this.t, L = this.L, cap = this.cap, dlL = this.dlL, dlR = this.dlR, dlC = this.dlC, qv = this.qv, qt = this.qt, r1 = this.r1, r2 = this.r2, L1 = this.L1, L2 = this.L2;
    const c0 = v[7], c1 = c0 + (t[7] - c0) * k, dc = (c1 - c0) / n, w0 = v[8], w1 = w0 + (t[8] - w0) * k, dw = (w1 - w0) / n, o0 = v[1], o1 = o0 + (t[1] - o0) * k, doo = (o1 - o0) / n; v[7] = c1; v[8] = w1; v[1] = o1;
    let dp = this.dp, qh = this.qh, qs = this.qs, tt = this.tt, i1 = this.i1, i2 = this.i2, s1 = this.s1, s2 = this.s2, eF = this.eF, eS = this.eS, pkL = this.mt[0], pkR = this.mt[1], minE = this.mt[3], chk = 0, clamps = 0;
    const aR = this.lAR, aSA = this.lSA, aSR = this.lSR, auto = this.lAuto;
    for (let i = 0; i < n; i++) {
      const og = o0 + doo * (i + 1), ceil = c0 + dc * (i + 1), w = w0 + dw * (i + 1), l = A[i] * og, r = B[i] * og, al = l < 0 ? -l : l, ar = r < 0 ? -r : r, pk = al > ar ? al : ar;
      const g = pk > ceil ? ceil / pk : 1;
      // min geser (deque monoton) atas L+1 nilai terakhir
      while (qs > 0) { let ix = qh + qs - 1; if (ix >= cap) ix -= cap; if (qv[ix] >= g) qs--; else break; }
      { let ix = qh + qs; if (ix >= cap) ix -= cap; qv[ix] = g; qt[ix] = tt; qs++; }
      while (qt[qh] < tt - L) { qh++; if (qh === cap) qh = 0; qs--; }
      const m = qv[qh];
      s1 += m - r1[i1]; r1[i1] = m; if (++i1 === L1) i1 = 0; const a1 = s1 / L1;
      s2 += a1 - r2[i2]; r2[i2] = a1; if (++i2 === L2) i2 = 0; const s = s2 / L2;
      eF = s < eF ? s : s + (eF - s) * aR; let e = eF;
      if (auto) { eS = s < eS ? s + (eS - s) * aSA : s + (eS - s) * aSR; if (eS < e) e = eS; }
      const dL = dlL[dp], dR = dlR[dp], dC = dlC[dp]; dlL[dp] = l; dlR[dp] = r; dlC[dp] = ceil; if (++dp === L) dp = 0; tt++;
      const gain = 1 - w + w * e, hard = dC + (1 - w) * 8; let yl = dL * gain, yr = dR * gain; // klamp memakai ceiling saat sampel itu dideteksi (tertunda L), bukan ceiling sekarang
      const hx = hard * 1.000001; // klamp dihitung hanya bila melewati batas lebih dari 1e-6 relatif; selisih pembulatan float tidak dianggap
      if (yl > hard) { if (yl > hx) clamps++; yl = hard; } else if (yl < -hard) { if (yl < -hx) clamps++; yl = -hard; }
      if (yr > hard) { if (yr > hx) clamps++; yr = hard; } else if (yr < -hard) { if (yr < -hx) clamps++; yr = -hard; }
      outL[i] = yl; outR[i] = yr; chk += yl + yr; const ay = yl < 0 ? -yl : yl, by = yr < 0 ? -yr : yr; if (ay > pkL) pkL = ay; if (by > pkR) pkR = by; if (w > 0.5 && e < minE) minE = e;
    }
    this.dp = dp; this.qh = qh; this.qs = qs; this.tt = tt; this.i1 = i1; this.i2 = i2; this.eF = eF; this.eS = eS; this.clamps += clamps;
    let a = 0, b = 0; for (let j = 0; j < L1; j++) a += r1[j]; for (let j = 0; j < L2; j++) b += r2[j]; this.s1 = a; this.s2 = b; // hapus drift jumlah berjalan
    this.mt[0] = pkL; this.mt[1] = pkR; this.mt[3] = minE;
    if (chk !== chk || chk === Infinity || chk === -Infinity) { this.nan++; this.reset(); for (let i = 0; i < n; i++) { outL[i] = 0; outR[i] = 0; } }
  }
}
