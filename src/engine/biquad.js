// biquad.js — RBJ-cookbook IIR design, cascades, Linkwitz-Riley crossovers, M/S EQ
export function designBiquad(type, f, q, gainDb, fs) {
  const w0 = 2 * Math.PI * Math.min(Math.max(f, 1), fs * 0.4995) / fs;
  const cw = Math.cos(w0), sw = Math.sin(w0), Q = Math.max(q || 0.7071, 0.02), alpha = sw / (2 * Q), A = Math.pow(10, (gainDb || 0) / 40);
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  switch (type) {
    case 'lp': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'hp': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'bp': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'ap': b0 = 1 - alpha; b1 = -2 * cw; b2 = 1 + alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'bell': case 'peak': b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
    case 'lowshelf': { const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
      a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break; }
    case 'highshelf': { const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
      a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break; }
    case 'lp1': { const k = Math.tan(w0 / 2); b0 = k / (1 + k); b1 = b0; a1 = (k - 1) / (k + 1); break; }
    case 'hp1': { const k = Math.tan(w0 / 2); b0 = 1 / (1 + k); b1 = -b0; a1 = (k - 1) / (k + 1); break; }
    default: break;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
export function biquadMagSq(c, f, fs) {
  const w = 2 * Math.PI * f / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2, ni = -(c.b1 * s1 + c.b2 * s2), dr = 1 + c.a1 * c1 + c.a2 * c2, di = -(c.a1 * s1 + c.a2 * s2);
  return (nr * nr + ni * ni) / (dr * dr + di * di);
}
export function sectionsMagDb(secs, f, fs) { let p = 1; for (const s of secs) p *= biquadMagSq(s, f, fs); return 10 * Math.log10(p + 1e-300); }
// Cascade of biquads, transposed direct form II, double-precision state per channel
export class Biquads {
  constructor(sections, nch = 1) { this.sec = sections; this.st = []; for (let c = 0; c < nch; c++) this.st.push(new Float64Array(sections.length * 2)); }
  run(x, n, ch = 0) {
    const S = this.sec, z = this.st[ch];
    for (let k = 0; k < S.length; k++) {
      const c = S[k], b0 = c.b0, b1 = c.b1, b2 = c.b2, a1 = c.a1, a2 = c.a2;
      let z1 = z[2 * k], z2 = z[2 * k + 1];
      for (let i = 0; i < n; i++) { const xi = x[i], y = b0 * xi + z1; z1 = b1 * xi - a1 * y + z2; z2 = b2 * xi - a2 * y; x[i] = y; }
      if (Math.abs(z1) < 1e-30) z1 = 0; if (Math.abs(z2) < 1e-30) z2 = 0;
      z[2 * k] = z1; z[2 * k + 1] = z2;
    }
  }
}
export function butterSections(type, f, order, fs) {
  const t1 = type === 'hp' ? 'hp1' : 'lp1';
  if (order <= 1) return [designBiquad(t1, f, 0.7071, 0, fs)];
  if (order === 2) return [designBiquad(type, f, Math.SQRT1_2, 0, fs)];
  return [designBiquad(type, f, 0.5411961001461969, 0, fs), designBiquad(type, f, 1.3065629648763766, 0, fs)];
}
export function lr4Sections(type, f, fs) { const s = designBiquad(type, f, Math.SQRT1_2, 0, fs); return [s, Object.assign({}, s)]; }
export function allpassSection(f, fs) { return designBiquad('ap', f, Math.SQRT1_2, 0, fs); }
// 2-band LR4 split: lo + hi = allpass(f) * x (flat magnitude)
export class Crossover2 {
  constructor(f, fs, nch = 1) { this.lp = new Biquads(lr4Sections('lp', f, fs), nch); this.hp = new Biquads(lr4Sections('hp', f, fs), nch); }
  split(x, n, ch, lo, hi) { for (let i = 0; i < n; i++) { lo[i] = x[i]; hi[i] = x[i]; } this.lp.run(lo, n, ch); this.hp.run(hi, n, ch); }
}
// 4-band LR4 tree with allpass phase compensation: sum of bands = AP(f1)AP(f2)AP(f3) x
export class Crossover4 {
  constructor(f1, f2, f3, fs, nch = 1) {
    this.lp2 = new Biquads(lr4Sections('lp', f2, fs), nch); this.hp2 = new Biquads(lr4Sections('hp', f2, fs), nch);
    this.ap3 = new Biquads([allpassSection(f3, fs)], nch); this.ap1 = new Biquads([allpassSection(f1, fs)], nch);
    this.lp1 = new Biquads(lr4Sections('lp', f1, fs), nch); this.hp1 = new Biquads(lr4Sections('hp', f1, fs), nch);
    this.lp3 = new Biquads(lr4Sections('lp', f3, fs), nch); this.hp3 = new Biquads(lr4Sections('hp', f3, fs), nch);
  }
  split(x, n, ch, b) {
    const b1 = b[0], b2 = b[1], b3 = b[2], b4 = b[3];
    for (let i = 0; i < n; i++) { b1[i] = x[i]; b3[i] = x[i]; }
    this.lp2.run(b1, n, ch); this.ap3.run(b1, n, ch); for (let i = 0; i < n; i++) b2[i] = b1[i];
    this.lp1.run(b1, n, ch); this.hp1.run(b2, n, ch);
    this.hp2.run(b3, n, ch); this.ap1.run(b3, n, ch); for (let i = 0; i < n; i++) b4[i] = b3[i];
    this.lp3.run(b3, n, ch); this.hp3.run(b4, n, ch);
  }
}
// Mid/Side EQ: separate section lists for M and S
export class MSEQ {
  constructor(midSecs, sideSecs, stereo) {
    this.stereo = stereo; this.m = midSecs.length ? new Biquads(midSecs, 1) : null; this.s = (stereo && sideSecs.length) ? new Biquads(sideSecs, 1) : null;
    this.M = new Float64Array(0); this.S = new Float64Array(0);
  }
  processBlock(L, R, n) {
    if (!this.stereo || !R) { if (this.m) this.m.run(L, n, 0); return; }
    if (this.M.length < n) { this.M = new Float64Array(n); this.S = new Float64Array(n); }
    const M = this.M, S = this.S;
    for (let i = 0; i < n; i++) { M[i] = 0.5 * (L[i] + R[i]); S[i] = 0.5 * (L[i] - R[i]); }
    if (this.m) this.m.run(M, n, 0); if (this.s) this.s.run(S, n, 0);
    for (let i = 0; i < n; i++) { L[i] = M[i] + S[i]; R[i] = M[i] - S[i]; }
  }
}
