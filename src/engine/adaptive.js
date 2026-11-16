// adaptive.js — deterministic, rule-based adaptation of preset parameters to the measured audio (no AI/ML).
import { eqSections, toneSections } from './modules.js';
import { sectionsMagDb } from './biquad.js';
import { OCT_CENTERS, detectProblems } from './analysis.js';
import { clamp, cloneDeep } from './util.js';
function staticOctaves(s, fs) {
  const secs = [...eqSections(s.eq.bands, fs).mid, ...toneSections(s.tone, fs).mid];
  const v = OCT_CENTERS.map((c) => { let a = 0; for (let k = -2; k <= 2; k++) a += sectionsMagDb(secs, Math.min(c * Math.pow(2, k / 5), fs * 0.45), fs); return a / 5; });
  const ref = (v[3] + v[4] + v[5] + v[6]) / 4; return v.map((x) => x - ref);
}
export function planAdaptive(settings, an, genre) {
  const s = cloneDeep(settings), actions = [], problems = detectProblems(an, genre), has = (id) => problems.some((p) => p.id === id);
  if (!s.adaptive.on || !isFinite(an.loudness.integrated)) return { settings: s, actions, problems };
  const k = s.adaptive.strength ?? 1, fs = an.fs, st = staticOctaves(s, fs), rel = an.spectrum.octaveRel, t = genre.targetRel;
  OCT_CENTERS.forEach((f, i) => {
    const dev = rel[i] + st[i] - t[i]; if (Math.abs(dev) <= 2.5) return;
    const g = +clamp(-0.5 * (dev - Math.sign(dev) * 2.5) * k, -2.5 * k, 2.5 * k).toFixed(2); if (Math.abs(g) < 0.2) return;
    const band = i === 0 ? { type: 'lowshelf', f: 45, q: 0.7 } : i === 9 ? { type: 'highshelf', f: 11000, q: 0.7 } : { type: 'bell', f, q: 1.2 };
    s.eq.bands.push({ on: true, ...band, g, ch: 'stereo', auto: true });
    actions.push({ stage: 'Corrective EQ', text: `${f >= 1000 ? f / 1000 + ' kHz' : f + ' Hz'} octave ${dev > 0 ? '+' : ''}${dev.toFixed(1)} dB vs target → ${g > 0 ? '+' : ''}${g} dB` });
  });
  const res = (an.spectrum.resonances || []).filter((r) => r.excessDb > 6 && (r.persistence ?? 1) > 0.7 && r.freq > 150 && r.freq < 8000), harm = (a, b) => { const q = Math.max(a, b) / Math.min(a, b); return Math.abs(q - Math.round(q)) < 0.03; };
  for (const r of res.filter((r) => !res.some((o) => o !== r && harm(o.freq, r.freq))).slice(0, 2)) {
    const g = +(-Math.min(2, (r.excessDb - 4) * 0.5) * k).toFixed(2); s.eq.bands.push({ on: true, type: 'bell', f: r.freq, q: 8, g, ch: 'stereo', auto: true });
    actions.push({ stage: 'Corrective EQ', text: `Resonance ${r.freq} Hz (+${r.excessDb} dB) → ${g} dB notch` });
  }
  if (has('harsh')) { const b = s.dyneq.bands[2]; b.rangeDb += 1.5; b.offsetDb -= 2; actions.push({ stage: 'Dynamic EQ', text: 'Harshness control: range +1.5 dB, threshold −2 dB' }); }
  if (has('sibilance')) { const b = s.dyneq.bands[3]; b.rangeDb = Math.max(b.rangeDb, 6); b.offsetDb -= 2; actions.push({ stage: 'Dynamic EQ', text: 'De-esser range 6 dB, threshold −2 dB' }); }
  if (has('sub') || has('bass')) { const b = s.mb.bands[0]; b.ratio += 0.5; b.thrOffsetDb -= 1.5; actions.push({ stage: 'Multiband', text: 'Low band ratio +0.5, threshold −1.5 dB' }); }
  if (an.stereo) {
    const c = an.stereo.correlation;
    if (c < 0.3 && s.stereo.width > 100) { s.stereo.width = 100; actions.push({ stage: 'Stereo', text: `Correlation ${c.toFixed(2)} → widening disabled` }); }
    if (c < 0.05) s.stereo.width = 95;
    if (has('basswide') && !(s.stereo.bassMonoHz > 0)) { s.stereo.bassMonoHz = 100; actions.push({ stage: 'Stereo', text: 'Bass mono below 100 Hz enabled' }); }
    if (Math.abs(an.stereo.balanceDb) > 0.5) { s.stereo.balanceDb = +clamp(an.stereo.balanceDb * 0.5, -1.5, 1.5).toFixed(2); actions.push({ stage: 'Stereo', text: `L/R balance corrected by ${s.stereo.balanceDb} dB` }); }
  }
  if (has('squashed')) { s.comp.ratio = 1 + (s.comp.ratio - 1) * 0.5; s.mb.bands.forEach((b) => { b.ratio = 1 + (b.ratio - 1) * 0.5; }); s.clip.bypass = true; s.loud.maxLimitLu = Math.min(s.loud.maxLimitLu, 2);
    actions.push({ stage: 'Dynamics', text: 'Source already dense: compression halved, clipper off, limiting capped at 2 LU' }); }
  if (has('presence')) { s.tone.presenceDb += 0.8 * k; actions.push({ stage: 'Tonal', text: 'Presence +0.8 dB (weak vocal presence)' }); }
  if (has('clipping')) { s.clip.bypass = true; actions.push({ stage: 'Clipper', text: 'Source clipped → no additional clipping' }); }
  return { settings: s, actions, problems };
}
