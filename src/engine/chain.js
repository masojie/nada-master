// chain.js — offline 12-stage mastering render with auto-threshold measurement passes and loudness search.
import { PreStage, EQStage, LinearPhaseEQStage, DynEQStage, CompStage, MBStage, SatStage, StereoStage, ToneStage, ClipStage, runBlockStage } from './modules.js';
import { designBiquad, Biquads, Crossover4 } from './biquad.js';
import { runLimiter } from './limiter.js';
import { integratedLufs, measureTruePeak } from './loudness.js';
import { analyzeAudio } from './analysis.js';
import { dbToLin, gatedPercentile } from './util.js';
function blockLevels(chans, fs, ms, mk) {
  const N = chans[0].length, bl = Math.max(16, Math.round(fs * ms / 1000)), nb = Math.floor(N / bl), out = new Float32Array(nb), buf = new Float64Array(bl), fl = chans.map(() => (mk ? mk() : null));
  for (let b = 0; b < nb; b++) { let mx = 0; chans.forEach((x, c) => { for (let i = 0; i < bl; i++) buf[i] = x[b * bl + i]; if (fl[c]) fl[c](buf, bl); let s = 0; for (let i = 0; i < bl; i++) s += buf[i] * buf[i]; if (s > mx) mx = s; }); out[b] = 10 * Math.log10(mx / bl + 1e-30); }
  return out;
}
const filt = (sec) => () => { const f = new Biquads([sec], 1); return (x, n) => f.run(x, n, 0); };
function dynStats(chans, bands, fs) { return bands.map((b) => (b.on ? gatedPercentile(blockLevels(chans, fs, 10, filt(designBiquad('bp', b.f, b.q, 0, fs))), 0.5, -25) : NaN)); }
function mbStats(chans, xo, fs) {
  const N = chans[0].length, bl = Math.round(fs * 0.05), nb = Math.floor(N / bl), X = new Crossover4(xo[0], xo[1], xo[2], fs, chans.length), lv = [0, 1, 2, 3].map(() => new Float32Array(nb));
  const x = new Float64Array(bl), b = [0, 1, 2, 3].map(() => new Float64Array(bl));
  for (let k = 0; k < nb; k++) { const mx = [0, 0, 0, 0]; chans.forEach((ch, c) => { for (let i = 0; i < bl; i++) x[i] = ch[k * bl + i]; X.split(x, bl, c, b); for (let j = 0; j < 4; j++) { let s = 0; for (let i = 0; i < bl; i++) s += b[j][i] * b[j][i]; if (s > mx[j]) mx[j] = s; } });
    for (let j = 0; j < 4; j++) lv[j][k] = 10 * Math.log10(mx[j] / bl + 1e-30); }
  return lv.map((l) => gatedPercentile(l, 0.9, -25));
}
function applyGain(chans, g) { if (g === 1) return; for (const x of chans) for (let i = 0; i < x.length; i++) x[i] *= g; }
export function renderMaster(input, S, an, onProgress = () => {}) {
  const fs = input.fs, nch = input.chans.length, work = input.chans.map((c) => new Float32Array(c)), rep = { stages: {}, timings: {}, notes: [] };
  const stage = (id, label, fn) => { onProgress({ id, label }); const t = Date.now(); rep.stages[id] = fn() || {}; rep.timings[id] = Date.now() - t; };
  stage('pre', 'Pre-processing', () => { if (S.pre.bypass) return { bypassed: true }; const m = new PreStage(S.pre, fs, nch, an); runBlockStage(m, work); return m.report(); });
  stage('eq', 'Corrective EQ', () => { if (S.eq.bypass) return { bypassed: true }; const m = S.eq.phase === 'linear' ? new LinearPhaseEQStage(S.eq, fs, nch) : new EQStage(S.eq, fs, nch); runBlockStage(m, work); return m.report(); });
  stage('dyneq', 'Dynamic EQ', () => { if (S.dyneq.bypass) return { bypassed: true }; const m = new DynEQStage(S.dyneq, fs, nch, S.dyneq.autoThr !== false ? dynStats(work, S.dyneq.bands, fs) : null); runBlockStage(m, work); return m.report(); });
  stage('comp', 'Bus Compression', () => { if (S.comp.bypass) return { bypassed: true }; let thr = S.comp.thrDb;
    if (S.comp.autoThr !== false) { const lv = blockLevels(work, fs, 50, S.comp.scHpfHz > 0 ? filt(designBiquad('hp', S.comp.scHpfHz, 0.7071, 0, fs)) : null), p = gatedPercentile(lv, 0.9, -20); if (isFinite(p)) thr = p + S.comp.thrOffsetDb; }
    const m = new CompStage(S.comp, fs, nch, thr); runBlockStage(m, work); return m.report(); });
  stage('mb', 'Multiband', () => { if (S.mb.bypass) return { bypassed: true }; const st = S.mb.autoThr !== false ? mbStats(work, S.mb.xover, fs) : null;
    const m = new MBStage(S.mb, fs, nch, S.mb.bands.map((b, i) => (st && isFinite(st[i]) ? st[i] + b.thrOffsetDb : b.thrDb))); runBlockStage(m, work); return m.report(); });
  stage('sat', 'Saturation & Harmonics', () => { if (S.sat.bypass) return { bypassed: true }; const m = new SatStage(S.sat, fs, nch); runBlockStage(m, work); const r = m.report();
    if (S.sat.autoGain !== false && isFinite(r.levelChangeDb)) applyGain(work, dbToLin(-r.levelChangeDb)); return r; });
  stage('stereo', 'Stereo Image', () => { if (S.stereo.bypass || nch < 2) return { bypassed: true }; const m = new StereoStage(S.stereo, fs, nch); runBlockStage(m, work); return m.report(); });
  stage('tone', 'Tonal Enhancement', () => { if (S.tone.bypass) return { bypassed: true }; runBlockStage(new ToneStage(S.tone, fs, nch), work); return {}; });
  onProgress({ id: 'loud', label: 'Clipper · Limiter · Loudness' }); const t0 = Date.now();
  const P = work.map((c) => new Float32Array(c)), Lp = integratedLufs(P, fs), target = S.loud.targetLufs, maxLoss = S.loud.maxLimitLu, scratch = {};
  const runAt = (gDb, marginDb = 0) => {
    work.forEach((w, c) => w.set(P[c])); applyGain(work, dbToLin(gDb));
    const clip = S.clip.bypass ? null : (() => { const m = new ClipStage(S.clip, S.lim.ceilingDb, fs, nch); runBlockStage(m, work); return m.report(); })();
    const lim = S.lim.bypass ? null : runLimiter(work, S.lim, fs, { marginDb, scratch });
    const L = integratedLufs(work, fs); return { gDb, L, loss: Lp + gDb - L, clip, lim, marginDb };
  };
  let r, capped = false; const hist = [];
  if (!isFinite(Lp)) { r = runAt(0); rep.notes.push('Silent input: loudness stage skipped.'); }
  else if (S.loud.bypass) r = runAt(S.lim.driveDb || 0);
  else if (S.lim.bypass) { const tp = measureTruePeak(P, fs, 0, scratch).dbtp; let g = target - Lp; if (g > S.lim.ceilingDb - tp) { g = S.lim.ceilingDb - tp; capped = true; } r = runAt(g); }
  else {
    r = runAt(target - Lp); hist.push(r);
    for (let it = 0; it < 6; it++) {
      const over = S.loud.preserveDynamics && r.loss > maxLoss + 0.1, err = r.L - target;
      if (!over && Math.abs(err) <= 0.1) break; if (!over && err > 0 && capped) break;
      const f = over ? (h) => h.loss - maxLoss : (h) => h.L - target, a = hist[hist.length - 2], b = hist[hist.length - 1];
      let g = b.gDb - f(b) * (over ? 1 : 1.25); if (a && Math.abs(f(b) - f(a)) > 1e-3) g = b.gDb - f(b) * (b.gDb - a.gDb) / (f(b) - f(a));
      g = Math.max(b.gDb - 6, Math.min(b.gDb + 6, g)); if (over) capped = true; if (Math.abs(g - b.gDb) < 0.01) break;
      r = runAt(g); hist.push(r);
    }
    if (S.loud.preserveDynamics && r.loss > maxLoss + 0.3) { const ok = hist.filter((h) => h.loss <= maxLoss + 0.3).sort((x, y) => y.L - x.L)[0]; if (ok) r = runAt(ok.gDb); }
  }
  let tp = measureTruePeak(work, fs, 0, scratch).dbtp, tries = 0;
  while (!S.lim.bypass && tp > S.lim.ceilingDb + 0.005 && tries < 3) { r = runAt(r.gDb, r.marginDb + (tp - S.lim.ceilingDb) + 0.02); tp = measureTruePeak(work, fs, 0, scratch).dbtp; tries++; }
  if (S.lim.trimDb) applyGain(work, dbToLin(Math.min(0, S.lim.trimDb)));
  rep.stages.clip = r.clip || { bypassed: true }; rep.stages.lim = r.lim ? { ...r.lim, grSeries: undefined } : { bypassed: true }; rep.grSeries = r.lim ? r.lim.grSeries : null; rep.timings.loud = Date.now() - t0;
  const fin = integratedLufs(work, fs);
  rep.loudness = { target, preLimiterLufs: +Lp.toFixed(2), gainDb: +r.gDb.toFixed(2), finalLufs: +fin.toFixed(2), limitingLu: +r.loss.toFixed(2), capped, maxLimitLu: maxLoss, iterations: hist.length };
  if (capped && fin < target - 0.3) rep.notes.push(`Target ${target} LUFS needs more than ${maxLoss} LU of limiting; stopped at ${fin.toFixed(1)} LUFS to preserve dynamics.`);
  onProgress({ id: 'analysis', label: 'Analysing master' }); const t1 = Date.now(); const man = analyzeAudio(work, fs); rep.timings.analysis = Date.now() - t1;
  return { chans: work, fs, report: rep, analysis: man };
}
