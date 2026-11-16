// settings.js — resolves (genre preset + voicing + mastering mode + loudness target) into full engine settings.
import { cloneDeep, clamp } from './util.js';
import { GENRES, genreById, applyVoicing, VOICINGS, CATEGORIES } from '../presets/genres.js';
export { GENRES, VOICINGS, CATEGORIES };
export const BASE_FULL = {
  pre: { bypass: false, inputGainDb: 0, autoHeadroom: true, refLufs: -18, dcRemove: true, rumble: true, rumbleHz: 25, rumbleSlope: 24 },
  eq: { bypass: false, phase: 'minimum', bands: [] },
  dyneq: { bypass: false, autoThr: true, bands: [
    { on: true, name: 'Low-End Control', f: 70, q: 0.9, offsetDb: 6, thrDb: -24, ratio: 2, attackMs: 15, releaseMs: 150, rangeDb: 3, ch: 'mid' },
    { on: true, name: 'Vocal Presence', f: 1800, q: 1.2, offsetDb: 7, thrDb: -30, ratio: 1.8, attackMs: 8, releaseMs: 120, rangeDb: 2, ch: 'mid' },
    { on: true, name: 'Harshness', f: 3300, q: 1.4, offsetDb: 6, thrDb: -32, ratio: 2.5, attackMs: 3, releaseMs: 80, rangeDb: 3, ch: 'stereo' },
    { on: true, name: 'De-Esser', f: 7000, q: 2, offsetDb: 8, thrDb: -36, ratio: 3, attackMs: 1, releaseMs: 50, rangeDb: 4, ch: 'stereo' }] },
  comp: { bypass: false, autoThr: true, thrOffsetDb: -3, thrDb: -20, ratio: 1.8, attackMs: 30, releaseMs: 200, autoRelease: true, kneeDb: 6, makeupDb: 0, mix: 100, scHpfHz: 90, rmsMs: 10 },
  mb: { bypass: false, autoThr: true, xover: [120, 1000, 6000], bands: [0, 1, 2, 3].map(() => ({ on: true, thrOffsetDb: -4, thrDb: -26, ratio: 1.5, attackMs: 20, releaseMs: 150, gainDb: 0 })) },
  sat: { bypass: false, os: 2, autoGain: true, tape: { on: false, driveDb: 2, mix: 40 }, tube: { on: false, driveDb: 2, mix: 40, bias: 0.2 }, transformer: { on: false, driveDb: 2, mix: 40 }, soft: { on: false, driveDb: 2, mix: 40 }, exciter: { on: true, freq: 7000, amount: 4 } },
  stereo: { bypass: false, width: 100, widthHz: 250, bassMonoHz: 100, monoAmount: 100, balanceDb: 0, midDb: 0, sideDb: 0 },
  tone: { bypass: false, airDb: 0, airHz: 12000, lowDb: 0, lowHz: 100, clarityDb: 0, clarityHz: 400, presenceDb: 0, presenceHz: 3500 },
  clip: { bypass: true, mode: 'soft', thrDb: 1, kneeDb: 2, os: 4 },
  lim: { bypass: false, ceilingDb: -1, lookaheadMs: 3, releaseMs: 100, autoRelease: true, style: 'balanced', tpDetect: true, driveDb: 0, trimDb: 0 },
  loud: { bypass: false, targetLufs: -11, maxLimitLu: 3.5, preserveDynamics: true },
  adaptive: { on: true, strength: 1 }
};
export const MODES = [
  { id: 'transparent', name: 'Transparent', desc: 'Minimal processing — preserves the original mix.' },
  { id: 'warm', name: 'Warm Analog', desc: 'Subtle harmonic richness, smooth top end.' },
  { id: 'modern', name: 'Modern Commercial', desc: 'Polished, competitive, clean.' },
  { id: 'loud', name: 'Loud', desc: 'Maximum perceived loudness with distortion control.' },
  { id: 'dynamic', name: 'Dynamic', desc: 'Preserves transients and natural dynamic range.' }];
export const LOUDNESS_TARGETS = [
  { id: 'auto', name: 'Auto (genre + mode)', lufs: null }, { id: 'spotify', name: 'Spotify −14 LUFS', lufs: -14 }, { id: 'apple', name: 'Apple Music −16 LUFS', lufs: -16 },
  { id: 'youtube', name: 'YouTube −14 LUFS', lufs: -14 }, { id: 'commercial', name: 'Commercial −9.5 LUFS', lufs: -9.5 }, { id: 'dynamic', name: 'Dynamic −16 LUFS', lufs: -16 }, { id: 'custom', name: 'Custom', lufs: null }];
export function modeTarget(mode, L) { return { transparent: Math.min(-14, L), warm: L - 0.5, modern: L, loud: Math.min(-7.5, L + 1.5), dynamic: clamp(Math.min(-14, L - 3), -18, -14) }[mode] ?? L; }
function fromPreset(g) {
  const s = cloneDeep(BASE_FULL), p = g.settings;
  Object.assign(s.pre, p.pre || {});
  s.eq.bands = (p.eq || []).map((b) => ({ ch: 'stereo', ...b, on: b.on !== false }));
  Object.assign(s.tone, p.tone || {}); Object.assign(s.comp, p.comp || {});
  if (p.mb) { s.mb.xover = p.mb.xover || s.mb.xover; s.mb.bands = s.mb.bands.map((b, i) => ({ ...b, ...(p.mb.bands || [])[i], thrOffsetDb: (p.mb.thrOffsetDb || [])[i] ?? b.thrOffsetDb })); }
  if (p.sat && p.sat.type && s.sat[p.sat.type]) Object.assign(s.sat[p.sat.type], { on: true, driveDb: p.sat.driveDb ?? 2, mix: p.sat.mix ?? 40 });
  Object.assign(s.stereo, p.stereo || {});
  if (p.clip) { s.clip.bypass = !p.clip.on; Object.assign(s.clip, { mode: p.clip.mode || 'soft', thrDb: Math.max(1, p.clip.thrDb ?? 1), kneeDb: p.clip.kneeDb ?? 2 }); }
  Object.assign(s.lim, p.limiter || {});
  return s;
}
function applyMode(s, mode) {
  const sats = ['tape', 'tube', 'transformer', 'soft'];
  if (mode === 'transparent') {
    s.comp.ratio = 1 + (s.comp.ratio - 1) * 0.5; s.comp.thrOffsetDb += 1.5; s.mb.bands.forEach((b) => { b.ratio = 1 + (b.ratio - 1) * 0.4; b.thrOffsetDb += 1.5; });
    sats.forEach((k) => { s.sat[k].driveDb *= 0.4; s.sat[k].mix *= 0.7; }); s.sat.exciter.amount *= 0.4; s.stereo.width = 100 + (s.stereo.width - 100) * 0.4;
    ['airDb', 'lowDb', 'clarityDb', 'presenceDb'].forEach((k) => { s.tone[k] *= 0.5; }); s.dyneq.bands.forEach((b) => { b.rangeDb *= 0.7; });
    s.clip.bypass = true; Object.assign(s.lim, { style: 'transparent', lookaheadMs: 5, releaseMs: s.lim.releaseMs * 1.4 }); s.loud.maxLimitLu = 1.5; s.adaptive.strength = 0.6;
  } else if (mode === 'warm') {
    s.sat.tape.on = true; s.sat.tape.driveDb = Math.max(s.sat.tape.driveDb, 2.5) * 1.4; s.sat.tape.mix = Math.max(s.sat.tape.mix, 50);
    s.sat.tube.on = true; s.sat.tube.driveDb = Math.max(s.sat.tube.driveDb, 1.5) * 1.3; s.sat.tube.mix = Math.max(s.sat.tube.mix, 35); s.sat.exciter.amount *= 0.6;
    s.tone.airDb -= 0.4; s.tone.lowDb += 0.4; s.comp.attackMs *= 1.2; s.comp.releaseMs *= 1.2; s.lim.style = 'transparent'; s.loud.maxLimitLu = 2.5;
  } else if (mode === 'loud') {
    s.comp.ratio *= 1.15; s.comp.thrOffsetDb -= 1; s.mb.bands.forEach((b) => { b.ratio *= 1.15; }); s.clip.bypass = false; s.clip.thrDb = 0.5; s.clip.mode = 'soft';
    Object.assign(s.lim, { style: 'punchy', releaseMs: s.lim.releaseMs * 0.7, lookaheadMs: 2 }); s.loud.maxLimitLu = 6;
  } else if (mode === 'dynamic') {
    s.comp.ratio = 1 + (s.comp.ratio - 1) * 0.6; s.comp.attackMs *= 1.6; s.comp.thrOffsetDb += 1; s.mb.bands.forEach((b) => { b.ratio = 1 + (b.ratio - 1) * 0.5; });
    sats.forEach((k) => { s.sat[k].driveDb *= 0.7; }); s.clip.bypass = true; Object.assign(s.lim, { style: 'transparent', releaseMs: s.lim.releaseMs * 1.3 }); s.loud.maxLimitLu = 1.5;
  } else { s.loud.maxLimitLu = 3.5; }
}
export function getGenre(id) { return genreById[id] || GENRES[0]; }
export function resolveSettings({ genre = GENRES[0].id, mode = 'modern', voicing = 'balanced', loudness = 'auto', customLufs, ceilingDb, adaptive = true } = {}) {
  const g = applyVoicing(getGenre(genre), voicing), s = fromPreset(g); applyMode(s, mode);
  const lt = LOUDNESS_TARGETS.find((t) => t.id === loudness);
  s.loud.targetLufs = +(loudness === 'custom' && isFinite(customLufs) ? customLufs : (lt && lt.lufs != null ? lt.lufs : modeTarget(mode, g.lufs))).toFixed(1);
  if (isFinite(ceilingDb)) s.lim.ceilingDb = ceilingDb; s.adaptive.on = adaptive !== false;
  s.meta = { genre: g.id, genreName: g.name, mode, voicing, loudness };
  return s;
}
