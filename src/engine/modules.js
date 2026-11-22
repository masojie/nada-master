// modules.js — mastering processors. Block modules expose processBlock(L, R|null, n) on Float64 blocks and optional latency.
import { designBiquad, Biquads, butterSections, Crossover2, Crossover4, MSEQ, allpassSection, sectionsMagDb } from './biquad.js';
import { Oversampler } from './oversample.js';
import { FFT, nextPow2 } from './fft.js';
import { dbToLin, clamp, tcCoef, fastTanh, DelayLine, kaiserWin } from './util.js';
export const BLOCK = 4096;
// soft-knee downward gain computer: level dB in -> gain change dB (<= 0)
export function gcDb(x, T, R, W) { const d = x - T; if (2 * d < -W) return 0; if (W > 0 && 2 * Math.abs(d) <= W) { const t = d + W / 2; return (1 / R - 1) * t * t / (2 * W); } return (1 / R - 1) * d; }
// ---------- Stage 1: pre-processing (gain staging, DC removal, rumble filter) ----------
export class PreStage {
  constructor(p, fs, nch, an) {
    let gDb = p.inputGainDb || 0; this.autoDb = 0;
    if (p.autoHeadroom && an && isFinite(an.loudness.integrated)) { this.autoDb = clamp(p.refLufs - an.loudness.integrated, -30, 30); gDb += this.autoDb; }
    this.g = dbToLin(gDb); this.gainDb = gDb;
    this.dc = (p.dcRemove && an) ? an.channels.map((c) => c.dc) : null;
    this.hp = p.rumble ? new Biquads(butterSections('hp', p.rumbleHz, p.rumbleSlope >= 24 ? 4 : 2, fs), nch) : null;
  }
  processBlock(L, R, n) {
    const chs = R ? [L, R] : [L];
    chs.forEach((x, c) => { const dc = this.dc ? this.dc[c] : 0, g = this.g; for (let i = 0; i < n; i++) x[i] = (x[i] - dc) * g; if (this.hp) this.hp.run(x, n, c); });
  }
  report() { return { gainDb: +this.gainDb.toFixed(2), autoGainDb: +this.autoDb.toFixed(2), dcRemoved: !!this.dc }; }
}
// ---------- Stage 2: corrective EQ (minimum or linear phase) ----------
export function eqSections(bands, fs) {
  const mid = [], side = [];
  for (const b of bands) {
    if (!b.on) continue; let secs;
    if (b.type === 'hp' || b.type === 'lp') secs = b.slope >= 24 ? butterSections(b.type, b.f, 4, fs) : [designBiquad(b.type, b.f, b.q || 0.7071, 0, fs)];
    else { if (Math.abs(b.g || 0) < 0.01 && b.type !== 'notch') continue; secs = [designBiquad(b.type === 'bell' ? 'peak' : b.type, b.f, b.q, b.g, fs)]; }
    if (b.ch !== 'side') mid.push(...secs); if (b.ch !== 'mid') side.push(...secs);
  }
  return { mid, side };
}
export class EQStage {
  constructor(p, fs, nch) { const s = eqSections(p.bands, fs); this.eq = new MSEQ(s.mid, s.side, nch > 1); this.n = s.mid.length + s.side.length; }
  processBlock(L, R, n) { this.eq.processBlock(L, R, n); }
  report() { return { sections: this.n, phase: 'minimum' }; }
}
// zero-phase target magnitude -> Kaiser-windowed FIR; M and S packed into one complex overlap-save FFT.
// The FIR spans about 0.74 s so low-frequency and narrow-Q bands are realised accurately (4095 taps missed a 100 Hz bell by 1.6 dB).
export class LinearPhaseEQStage {
  constructor(p, fs, nch) {
    const s = eqSections(p.bands, fs); this.stereo = nch > 1;
    const taps = fs > 100000 ? 131071 : fs > 50000 ? 65535 : 32767; this.taps = taps;
    const NF = nextPow2(taps * 2); this.NF = NF; this.fft = new FFT(NF); this.hop = NF - taps + 1;
    this.HM = this.design(s.mid, fs, taps); this.HS = this.design(s.side, fs, taps);
    this.inM = new Float64Array(NF); this.inS = new Float64Array(NF); this.fill = taps - 1; this.re = new Float64Array(NF); this.im = new Float64Array(NF);
    this.outQ = [[new Float64Array(this.hop), new Float64Array(this.hop)]]; this.outPos = 0; this.latency = this.hop + (taps - 1) / 2;
  }
  design(secs, fs, taps) {
    const NF = this.NF, re = new Float64Array(NF), im = new Float64Array(NF);
    for (let k = 0; k <= NF / 2; k++) { const m = secs.length ? Math.pow(10, sectionsMagDb(secs, Math.max(k * fs / NF, 1), fs) / 20) : 1; re[k] = m; if (k > 0 && k < NF / 2) re[NF - k] = m; }
    this.fft.transform(re, im, true); const h = new Float64Array(NF), c = (taps - 1) / 2;
    for (let j = 0; j < taps; j++) { const d = j - c, idx = (d + NF) % NF; h[j] = re[idx] * kaiserWin(d / (c + 1), 7); }
    const Hr = new Float64Array(NF), Hi = new Float64Array(NF); Hr.set(h); this.fft.transform(Hr, Hi, false); return { Hr, Hi };
  }
  _block() {
    const NF = this.NF, re = this.re, im = this.im; re.set(this.inM); im.set(this.inS); this.fft.transform(re, im, false);
    const mr = this.HM.Hr, mi = this.HM.Hi, sr = this.HS.Hr, si = this.HS.Hi;
    for (let k = 0; k <= NF / 2; k++) {
      const k2 = (NF - k) % NF, zr = re[k], zi = im[k], cr = re[k2], ci = -im[k2];
      const xmr = 0.5 * (zr + cr), xmi = 0.5 * (zi + ci), xsr = 0.5 * (zi - ci), xsi = -0.5 * (zr - cr);
      const ymr = xmr * mr[k] - xmi * mi[k], ymi = xmr * mi[k] + xmi * mr[k], ysr = xsr * sr[k] - xsi * si[k], ysi = xsr * si[k] + xsi * sr[k];
      re[k] = ymr - ysi; im[k] = ymi + ysr;
      if (k2 !== k) { re[k2] = ymr + ysi; im[k2] = -ymi + ysr; }
    }
    this.fft.transform(re, im, true);
    const off = this.taps - 1, h = this.hop, qm = new Float64Array(h), qs = new Float64Array(h);
    for (let i = 0; i < h; i++) { qm[i] = re[off + i]; qs[i] = im[off + i]; }
    this.outQ.push([qm, qs]);
    this.inM.copyWithin(0, h); this.inS.copyWithin(0, h); this.fill = this.taps - 1;
  }
  processBlock(L, R, n) {
    for (let i = 0; i < n; i++) {
      const l = L[i], r = R ? R[i] : l; this.inM[this.fill] = 0.5 * (l + r); this.inS[this.fill] = 0.5 * (l - r); this.fill++;
      if (this.fill === this.NF) this._block();
    }
    for (let i = 0; i < n; i++) {
      while (this.outQ.length && this.outPos >= this.outQ[0][0].length) { this.outQ.shift(); this.outPos = 0; }
      let m = 0, s = 0; if (this.outQ.length) { m = this.outQ[0][0][this.outPos]; s = this.outQ[0][1][this.outPos]; this.outPos++; }
      L[i] = m + s; if (R) R[i] = m - s;
    }
  }
  report() { return { phase: 'linear', taps: this.taps, latency: this.latency }; }
}
// ---------- Stage 3: dynamic EQ (parallel band-pass gain: exactly transparent at unity) ----------
// the band-passed detector signal is also the signal the gain is applied to (one biquad per band and channel)
export class DynEQStage {
  constructor(p, fs, nch, stats) {
    this.stereo = nch > 1; this.bands = [];
    p.bands.forEach((b, i) => {
      if (!b.on) return; const ch = this.stereo ? b.ch : 'mid', sec = designBiquad('bp', b.f, b.q, 0, fs);
      const T = (p.autoThr !== false && stats && isFinite(stats[i])) ? stats[i] + b.offsetDb : b.thrDb;
      this.bands.push({ name: b.name, ch, T, R: Math.max(1, b.ratio), W: 4, range: Math.abs(b.rangeDb), aA: tcCoef(b.attackMs, fs), aR: tcCoef(b.releaseMs, fs),
        dM: new Biquads([sec], 1), dS: new Biquads([sec], 1), env: 0, minGr: 0, sumGr: 0, cnt: 0 });
    });
    this.M = new Float64Array(BLOCK); this.S = new Float64Array(BLOCK); this.t1 = new Float64Array(BLOCK); this.t2 = new Float64Array(BLOCK);
  }
  processBlock(L, R, n) {
    const M = this.M, S = this.S, st = this.stereo && R;
    for (let i = 0; i < n; i++) { M[i] = st ? 0.5 * (L[i] + R[i]) : L[i]; S[i] = st ? 0.5 * (L[i] - R[i]) : 0; }
    for (const b of this.bands) {
      const useM = b.ch !== 'side', useS = st && b.ch !== 'mid', dM = this.t1, dS = this.t2;
      for (let i = 0; i < n; i++) { dM[i] = M[i]; dS[i] = S[i]; }
      if (useM) b.dM.run(dM, n, 0); if (useS) b.dS.run(dS, n, 0);
      const kneeLo = Math.pow(10, (b.T - b.W / 2) / 20), T = b.T, Rr = b.R, W = b.W, rg = b.range, aA = b.aA, aR = b.aR; let env = b.env, mn = b.minGr, sm = 0;
      for (let i = 0; i < n; i++) {
        const lv = (useM ? Math.abs(dM[i]) : 0) + (useS ? Math.abs(dS[i]) : 0); let tg = 0;
        if (lv > kneeLo) { tg = gcDb(20 * Math.log10(lv), T, Rr, W); if (tg < -rg) tg = -rg; }
        env = tg < env ? tg + (env - tg) * aA : tg + (env - tg) * aR;
        if (env < -0.001) { const gm1 = Math.pow(10, env / 20) - 1; if (useM) M[i] += gm1 * dM[i]; if (useS) S[i] += gm1 * dS[i]; if (env < mn) mn = env; }
        sm += env;
      }
      b.env = env; b.minGr = mn; b.sumGr += sm; b.cnt += n;
    }
    for (let i = 0; i < n; i++) { if (st) { L[i] = M[i] + S[i]; R[i] = M[i] - S[i]; } else L[i] = M[i]; }
  }
  report() { return { bands: this.bands.map((b) => ({ name: b.name, thrDb: +b.T.toFixed(1), maxGrDb: +b.minGr.toFixed(2), avgGrDb: +(b.sumGr / Math.max(1, b.cnt)).toFixed(2) })) }; }
}
// ---------- Stage 4: bus compressor (RMS detector, soft knee, log-domain smoothing, dual auto-release, parallel mix) ----------
export class CompStage {
  constructor(p, fs, nch, thrDb) {
    this.T = thrDb; this.R = Math.max(1, p.ratio); this.W = Math.max(0, p.kneeDb); this.aA = tcCoef(p.attackMs, fs); this.aR = tcCoef(p.autoRelease ? p.releaseMs * 0.6 : p.releaseMs, fs);
    this.auto = !!p.autoRelease; this.aSA = tcCoef(Math.max(60, p.attackMs * 4), fs); this.aSR = tcCoef(p.releaseMs * 2.5, fs); this.aRms = tcCoef(Math.max(0.5, p.rmsMs), fs);
    this.sc = p.scHpfHz > 0 ? new Biquads([designBiquad('hp', p.scHpfHz, 0.7071, 0, fs)], nch) : null; this.mix = clamp(p.mix / 100, 0, 1); this.mk = dbToLin(p.makeupDb || 0);
    this.ms = [0, 0]; this.env = 0; this.envS = 0; this.minGr = 0; this.sumGr = 0; this.cnt = 0; this.sL = new Float64Array(BLOCK); this.sR = new Float64Array(BLOCK);
  }
  processBlock(L, R, n) {
    const sL = this.sL, sR = this.sR; for (let i = 0; i < n; i++) { sL[i] = L[i]; if (R) sR[i] = R[i]; }
    if (this.sc) { this.sc.run(sL, n, 0); if (R) this.sc.run(sR, n, 1); }
    const T = this.T, Rr = this.R, W = this.W, kneeLo = Math.pow(10, (T - W / 2) / 10), aRms = this.aRms, aA = this.aA, aR = this.aR, aSA = this.aSA, aSR = this.aSR, mix = this.mix, mk = this.mk;
    let mL = this.ms[0], mR = this.ms[1], env = this.env, envS = this.envS, mn = this.minGr, sm = 0;
    for (let i = 0; i < n; i++) {
      const a = sL[i] * sL[i]; mL = a + (mL - a) * aRms; let ms = mL;
      if (R) { const b = sR[i] * sR[i]; mR = b + (mR - b) * aRms; if (mR > ms) ms = mR; }
      const tg = ms > kneeLo ? gcDb(10 * Math.log10(ms), T, Rr, W) : 0;
      env = tg < env ? tg + (env - tg) * aA : tg + (env - tg) * aR; let gd = env;
      if (this.auto) { envS = tg < envS ? tg + (envS - tg) * aSA : tg + (envS - tg) * aSR; if (envS < gd) gd = envS; }
      const g = (gd < -0.0005 ? Math.pow(10, gd / 20) : 1) * mk, k = 1 - mix + mix * g;
      L[i] *= k; if (R) R[i] *= k; if (gd < mn) mn = gd; sm += gd;
    }
    this.ms[0] = mL; this.ms[1] = mR; this.env = env; this.envS = envS; this.minGr = mn; this.sumGr += sm; this.cnt += n;
  }
  report() { return { thrDb: +this.T.toFixed(1), maxGrDb: +this.minGr.toFixed(2), avgGrDb: +(this.sumGr / Math.max(1, this.cnt)).toFixed(2) }; }
}
// ---------- Stage 5: 4-band multiband compressor (LR4, phase-compensated tree) ----------
export class MBStage {
  constructor(p, fs, nch, thrs) {
    const f = p.xover; this.xo = new Crossover4(f[0], f[1], f[2], fs, nch); const rms = [25, 10, 5, 3];
    this.b = p.bands.map((b, k) => ({ on: b.on, T: thrs[k], R: Math.max(1, b.ratio), W: 6, aA: tcCoef(b.attackMs, fs), aR: tcCoef(b.releaseMs, fs), aRms: tcCoef(rms[k], fs), g: dbToLin(b.gainDb || 0), mL: 0, mR: 0, env: 0, mn: 0, sum: 0, cnt: 0 }));
    this.bL = [0, 1, 2, 3].map(() => new Float64Array(BLOCK)); this.bR = [0, 1, 2, 3].map(() => new Float64Array(BLOCK));
  }
  processBlock(L, R, n) {
    this.xo.split(L, n, 0, this.bL); if (R) this.xo.split(R, n, 1, this.bR);
    for (let k = 0; k < 4; k++) {
      const b = this.b[k], xl = this.bL[k], xr = this.bR[k], gs = b.g;
      if (!b.on) { if (gs !== 1) for (let i = 0; i < n; i++) { xl[i] *= gs; if (R) xr[i] *= gs; } continue; }
      const kneeLo = Math.pow(10, (b.T - b.W / 2) / 10), aRms = b.aRms, aA = b.aA, aR = b.aR; let mL = b.mL, mR = b.mR, env = b.env, mn = b.mn, sm = 0;
      for (let i = 0; i < n; i++) {
        const a = xl[i] * xl[i]; mL = a + (mL - a) * aRms; let ms = mL; if (R) { const c = xr[i] * xr[i]; mR = c + (mR - c) * aRms; if (mR > ms) ms = mR; }
        const tg = ms > kneeLo ? gcDb(10 * Math.log10(ms), b.T, b.R, b.W) : 0;
        env = tg < env ? tg + (env - tg) * aA : tg + (env - tg) * aR;
        const g = (env < -0.0005 ? Math.pow(10, env / 20) : 1) * gs; xl[i] *= g; if (R) xr[i] *= g; if (env < mn) mn = env; sm += env;
      }
      b.mL = mL; b.mR = mR; b.env = env; b.mn = mn; b.sum += sm; b.cnt += n;
    }
    const a = this.bL[0], b1 = this.bL[1], c = this.bL[2], d = this.bL[3]; for (let i = 0; i < n; i++) L[i] = a[i] + b1[i] + c[i] + d[i];
    if (R) { const e = this.bR[0], f = this.bR[1], g = this.bR[2], h = this.bR[3]; for (let i = 0; i < n; i++) R[i] = e[i] + f[i] + g[i] + h[i]; }
  }
  report() { return { bands: this.b.map((b) => ({ on: b.on, thrDb: +b.T.toFixed(1), maxGrDb: +b.mn.toFixed(2), avgGrDb: +(b.sum / Math.max(1, b.cnt)).toFixed(2) })) }; }
}
// ---------- oversampled residual processor: y = x(delayed) + down( f(up(x)) - up(x) ) ----------
// The clean signal passes untouched (bit-transparent when f is inactive); only the change is band-limited.
class OSResidual {
  constructor(nch, factor) {
    this.os = []; for (let c = 0; c < nch; c++) this.os.push(new Oversampler(factor));
    this.F = this.os[0].F; this.latency = this.os[0].latency; this.dly = []; for (let c = 0; c < nch; c++) this.dly.push(new DelayLine(this.latency));
    this.u = new Float64Array(BLOCK * this.F); this.r = new Float64Array(BLOCK * this.F); this.d = new Float64Array(BLOCK);
  }
  processBlock(L, R, n) {
    const chs = R ? [L, R] : [L];
    for (let c = 0; c < chs.length; c++) {
      const x = chs[c]; this.os[c].up(x, n, this.u); this.nonlinear(c, this.u, this.r, n * this.F); this.os[c].down(this.r, n, this.d);
      this.dly[c].process(x, n); const d = this.d; for (let i = 0; i < n; i++) x[i] += d[i];
    }
  }
}
// ---------- Stage 6: saturation and harmonics (tape, tube, transformer, soft, exciter) ----------
export class SatStage extends OSResidual {
  constructor(p, fs, nch) {
    super(nch, p.os || 2); const fh = fs * this.F, m = (o) => clamp((o.mix == null ? 100 : o.mix) / 100, 0, 1);
    const hp1 = (f) => new Biquads([designBiquad('hp1', f, 0.7, 0, fh)], nch);
    this.tape = p.tape.on ? { d: dbToLin(p.tape.driveDb), mix: m(p.tape), pre: new Biquads([designBiquad('highshelf', 3000, 0.5, 4, fh)], nch), de: new Biquads([designBiquad('highshelf', 3000, 0.5, -4, fh)], nch), bump: new Biquads([designBiquad('peak', 75, 0.9, 0.8, fh)], nch), dc: hp1(6) } : null;
    this.tube = p.tube.on ? { d: dbToLin(p.tube.driveDb), mix: m(p.tube), b: clamp(p.tube.bias == null ? 0.2 : p.tube.bias, 0, 0.6), dc: hp1(6) } : null;
    this.xf = p.transformer.on ? { d: dbToLin(p.transformer.driveDb), mix: m(p.transformer), lp: new Biquads([designBiquad('lp1', 150, 0.7, 0, fh)], nch) } : null;
    this.soft = p.soft.on ? { d: dbToLin(p.soft.driveDb), mix: m(p.soft) } : null;
    this.exc = p.exciter.on && p.exciter.amount > 0 ? { amt: p.exciter.amount / 100, h1: new Biquads([designBiquad('hp', p.exciter.freq, 0.7071, 0, fh)], nch), h2: new Biquads(butterSections('hp', p.exciter.freq, 4, fh), nch) } : null;
    this.s = new Float64Array(BLOCK * this.F); this.a = new Float64Array(BLOCK * this.F); this.eIn = 0; this.eOut = 0;
  }
  nonlinear(c, u, res, m) {
    const s = this.s, a = this.a; for (let i = 0; i < m; i++) s[i] = u[i];
    if (this.tape) { const t = this.tape, d = t.d, b = 0.04, tb = Math.tanh(b), nrm = 1 / ((1 - tb * tb) * d);
      for (let i = 0; i < m; i++) a[i] = s[i]; t.pre.run(a, m, c); for (let i = 0; i < m; i++) a[i] = (fastTanh(d * a[i] + b) - tb) * nrm;
      t.dc.run(a, m, c); t.de.run(a, m, c); t.bump.run(a, m, c); for (let i = 0; i < m; i++) s[i] += t.mix * (a[i] - s[i]); }
    if (this.tube) { const t = this.tube, d = t.d, b = t.b, tb = Math.tanh(b), nrm = 1 / ((1 - tb * tb) * d);
      for (let i = 0; i < m; i++) a[i] = (fastTanh(d * s[i] + b) - tb) * nrm; t.dc.run(a, m, c); for (let i = 0; i < m; i++) s[i] += t.mix * (a[i] - s[i]); }
    if (this.xf) { const t = this.xf, d = t.d; for (let i = 0; i < m; i++) a[i] = s[i]; t.lp.run(a, m, c);
      for (let i = 0; i < m; i++) { const lf = a[i], x = s[i], y = x + (fastTanh(d * lf) / d - lf) + 0.3 * (fastTanh(d * x) / d - x); s[i] += t.mix * (y - x); } }
    if (this.soft) { const t = this.soft, d = t.d; for (let i = 0; i < m; i++) { const x = s[i], v = d * x, y = v / Math.sqrt(1 + v * v) / d; s[i] += t.mix * (y - x); } }
    if (this.exc) { const e = this.exc; for (let i = 0; i < m; i++) a[i] = s[i]; e.h1.run(a, m, c); for (let i = 0; i < m; i++) a[i] = Math.abs(a[i]); e.h2.run(a, m, c); for (let i = 0; i < m; i++) s[i] += e.amt * a[i]; }
    let ei = 0, eo = 0; for (let i = 0; i < m; i++) { res[i] = s[i] - u[i]; ei += u[i] * u[i]; eo += s[i] * s[i]; } this.eIn += ei; this.eOut += eo;
  }
  report() { return { oversampling: this.F, levelChangeDb: +(10 * Math.log10((this.eOut + 1e-30) / (this.eIn + 1e-30))).toFixed(2) }; }
}
// ---------- Stage 7: stereo image (M/S, frequency-dependent width, bass mono, balance) ----------
export class StereoStage {
  constructor(p, fs, nch) {
    this.on = nch > 1; this.w = clamp(p.width / 100, 0, 2); this.mono = p.bassMonoHz > 0 ? clamp((p.monoAmount == null ? 100 : p.monoAmount) / 100, 0, 1) : 0;
    this.gL = dbToLin(-(p.balanceDb || 0) / 2); this.gR = dbToLin((p.balanceDb || 0) / 2); this.gM = dbToLin(p.midDb || 0); this.gS = dbToLin(p.sideDb || 0);
    this.uM = this.mono > 0; this.uW = Math.abs(this.w - 1) > 1e-3;
    if (this.uM) { this.xm = new Crossover2(p.bassMonoHz, fs, 1); this.apm = new Biquads([allpassSection(p.bassMonoHz, fs)], 1); }
    if (this.uW) { this.xw = new Crossover2(p.widthHz, fs, 1); this.apw = new Biquads([allpassSection(p.widthHz, fs)], 1); }
    this.M = new Float64Array(BLOCK); this.S = new Float64Array(BLOCK); this.lo = new Float64Array(BLOCK); this.hi = new Float64Array(BLOCK);
  }
  processBlock(L, R, n) {
    if (!this.on || !R) return; const M = this.M, S = this.S, lo = this.lo, hi = this.hi;
    for (let i = 0; i < n; i++) { const l = L[i] * this.gL, r = R[i] * this.gR; M[i] = 0.5 * (l + r); S[i] = 0.5 * (l - r); }
    if (this.uM) { this.xm.split(S, n, 0, lo, hi); const k = 1 - this.mono; for (let i = 0; i < n; i++) S[i] = hi[i] + k * lo[i]; this.apm.run(M, n, 0); }
    if (this.uW) { this.xw.split(S, n, 0, lo, hi); const w = this.w; for (let i = 0; i < n; i++) S[i] = lo[i] + w * hi[i]; this.apw.run(M, n, 0); }
    const gM = this.gM, gS = this.gS; for (let i = 0; i < n; i++) { const mm = M[i] * gM, ss = S[i] * gS; L[i] = mm + ss; R[i] = mm - ss; }
  }
  report() { return { width: Math.round(this.w * 100), bassMono: this.uM }; }
}
// ---------- Stage 8: tonal enhancement (air, low weight, vocal clarity, presence) as M/S EQ ----------
export function toneSections(p, fs) {
  const mid = [], side = [];
  if (Math.abs(p.lowDb) > 0.01) mid.push(designBiquad('lowshelf', p.lowHz, 0.7, p.lowDb, fs));
  if (Math.abs(p.clarityDb) > 0.01) mid.push(designBiquad('peak', p.clarityHz, 0.8, p.clarityDb, fs));
  if (Math.abs(p.presenceDb) > 0.01) mid.push(designBiquad('peak', p.presenceHz, 0.9, p.presenceDb, fs));
  if (Math.abs(p.airDb) > 0.01) { const a = designBiquad('highshelf', p.airHz, 0.6, p.airDb, fs); mid.push(a); side.push(Object.assign({}, a)); }
  return { mid, side };
}
export class ToneStage {
  constructor(p, fs, nch) { const s = toneSections(p, fs); this.eq = new MSEQ(s.mid, s.side, nch > 1); }
  processBlock(L, R, n) { this.eq.processBlock(L, R, n); }
  report() { return {}; }
}
// ---------- Stage 9: oversampled clipper (soft/hard) with distortion monitor ----------
export class ClipStage extends OSResidual {
  constructor(p, ceilingDb, fs, nch) {
    super(nch, p.os || 4); this.T = dbToLin(ceilingDb + p.thrDb); this.hard = p.mode === 'hard'; this.a = this.hard ? this.T : this.T * dbToLin(-Math.max(0.1, p.kneeDb == null ? 2 : p.kneeDb));
    this.cnt = 0; this.tot = 0; this.eD = 0; this.eS = 0; this.maxRed = 1;
  }
  nonlinear(c, u, res, m) {
    const T = this.T, a = this.a, span = T - a, hard = this.hard; let cnt = 0, eD = 0, eS = 0, mr = this.maxRed;
    for (let i = 0; i < m; i++) {
      const x = u[i], ax = x < 0 ? -x : x; eS += x * x; let d = 0;
      if (ax > a) { const y = hard ? T : a + span * fastTanh((ax - a) / span); d = (x > 0 ? y : -y) - x; cnt++; eD += d * d; const r = ax / y; if (r > mr) mr = r; }
      res[i] = d;
    }
    this.cnt += cnt; this.tot += m; this.eD += eD; this.eS += eS; this.maxRed = mr;
  }
  report() { return { clippedPct: +(100 * this.cnt / Math.max(1, this.tot)).toFixed(3), maxReductionDb: +(20 * Math.log10(this.maxRed)).toFixed(2), distortionDb: this.eD > 0 ? +(10 * Math.log10(this.eD / (this.eS + 1e-30))).toFixed(1) : -200, oversampling: this.F }; }
}
// generic driver: run a block module over full-length Float32 channels (in place, latency compensated)
export function runBlockStage(mod, chans) {
  const N = chans[0].length, lat = mod.latency | 0, L = new Float64Array(BLOCK), R = chans.length > 1 ? new Float64Array(BLOCK) : null, x0 = chans[0], x1 = chans[1];
  for (let r = 0; r < N + lat; r += BLOCK) {
    const n = Math.min(BLOCK, N + lat - r);
    for (let i = 0; i < n; i++) { const k = r + i; L[i] = k < N ? x0[k] : 0; if (R) R[i] = k < N ? x1[k] : 0; }
    mod.processBlock(L, R, n);
    for (let i = 0; i < n; i++) { const k = r + i - lat; if (k >= 0 && k < N) { x0[k] = L[i]; if (R) x1[k] = R[i]; } }
  }
}
