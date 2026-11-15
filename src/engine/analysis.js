// analysis.js — full-file measurement: loudness, peaks, dynamics, stereo, spectrum, transients + deterministic problem detection
import { measureLoudness, measureTruePeak } from './loudness.js';
import { Biquads, butterSections, lr4Sections } from './biquad.js';
import { FFT } from './fft.js';
import { percentileOf, powToDb } from './util.js';
export const OCT_CENTERS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const BAND_DEFS = [['sub', 20, 60], ['bass', 60, 250], ['lowMid', 250, 500], ['mid', 500, 2000], ['highMid', 2000, 4000], ['presence', 4000, 6000], ['brilliance', 6000, 12000], ['air', 12000, 20000]];
const toDbA = (v) => (v > 1e-30 ? 20 * Math.log10(v) : -200);
function basicStats(x) {
  let pk = 0, ss = 0, sum = 0; const N = x.length;
  for (let i = 0; i < N; i++) { const v = x[i], a = v < 0 ? -v : v; if (a > pk) pk = a; ss += v * v; sum += v; }
  let runs = 0, clipped = 0, run = 0; const thr = pk * 0.9995;
  if (pk >= 0.89) for (let i = 0; i < N; i++) { if (Math.abs(x[i]) >= thr) { run++; } else { if (run >= 3) { runs++; clipped += run; } run = 0; } }
  if (run >= 3) { runs++; clipped += run; }
  return { peak: pk, peakDb: toDbA(pk), rmsDb: toDbA(Math.sqrt(ss / Math.max(1, N))), dc: sum / Math.max(1, N), dcDb: toDbA(Math.abs(sum / Math.max(1, N))), clipRuns: runs, clipSamples: clipped };
}
function stereoStats(L, R, fs, hop) {
  const N = L.length, nHop = Math.ceil(N / hop), corr = new Float32Array(nHop); let sLL = 0, sRR = 0, sLR = 0, hLL = 0, hRR = 0, hLR = 0;
  for (let i = 0; i < N; i++) { const l = L[i], r = R[i]; sLL += l * l; sRR += r * r; sLR += l * r; hLL += l * l; hRR += r * r; hLR += l * r;
    if ((i + 1) % hop === 0 || i === N - 1) { const k = (i / hop) | 0, d = Math.sqrt(hLL * hRR); corr[k] = d > 1e-12 ? hLR / d : 1; hLL = 0; hRR = 0; hLR = 0; } }
  const c = sLR / Math.sqrt(sLL * sRR + 1e-30), sM = (sLL + sRR + 2 * sLR) / 4, sS = Math.max(0, (sLL + sRR - 2 * sLR) / 4);
  const bl = new Biquads(lr4Sections('lp', 150, fs), 2), B = 8192, a = new Float64Array(B), b = new Float64Array(B); let lLL = 0, lRR = 0, lLR = 0;
  for (let o = 0; o < N; o += B) { const n = Math.min(B, N - o); for (let i = 0; i < n; i++) { a[i] = L[o + i]; b[i] = R[o + i]; } bl.run(a, n, 0); bl.run(b, n, 1); for (let i = 0; i < n; i++) { lLL += a[i] * a[i]; lRR += b[i] * b[i]; lLR += a[i] * b[i]; } }
  const M = new Float32Array(N); for (let i = 0; i < N; i++) M[i] = 0.5 * (L[i] + R[i]);
  const monoI = measureLoudness([M], fs).integrated + 3.0103;
  return { correlation: c, correlationSeries: corr, correlationP5: percentileOf(corr, 0.05), sideToMidDb: powToDb(sS / (sM + 1e-30)), widthPct: 100 * Math.sqrt(sS / (sM + 1e-30)),
    balanceDb: powToDb(sLL / (sRR + 1e-30)), lowCorrelation: lLR / Math.sqrt(lLL * lRR + 1e-30), lowSideToMidDb: powToDb(Math.max(0, lLL + lRR - 2 * lLR) / (lLL + lRR + 2 * lLR + 1e-30)), monoFoldI: monoI };
}
function spectrumStats(chans, fs) {
  const N = chans[0].length, nf = fs > 100000 ? 32768 : fs > 50000 ? 16384 : 8192, hop = nf / 2, fft = new FFT(nf), half = nf / 2;
  const win = new Float64Array(nf); for (let i = 0; i < nf; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / nf);
  const L = chans[0], R = chans[1] || chans[0], st = chans.length > 1, frames = Math.max(1, Math.floor((N - nf) / hop) + 1), step = Math.max(1, Math.ceil(frames / 700));
  const PM = new Float64Array(half + 1), PS = new Float64Array(half + 1), re = new Float64Array(nf), im = new Float64Array(nf);
  const r24 = []; for (let f = 100; f <= Math.min(10000, fs * 0.45); f *= Math.pow(2, 1 / 24)) r24.push(f);
  const frameBands = []; let used = 0;
  for (let fr = 0; fr < frames; fr += step) {
    const o = fr * hop; for (let i = 0; i < nf; i++) { const k = o + i, l = k < N ? L[k] : 0, r = k < N ? R[k] : 0; re[i] = 0.5 * (l + r) * win[i]; im[i] = st ? 0.5 * (l - r) * win[i] : 0; }
    fft.transform(re, im); const fb = new Float32Array(r24.length), keep = frameBands.length < 320;
    for (let k = 0; k <= half; k++) { const k2 = (nf - k) % nf, zr = re[k], zi = im[k], cr = re[k2], ci = -im[k2];
      const mr = 0.5 * (zr + cr), mi = 0.5 * (zi + ci), sr = 0.5 * (zi - ci), si = -0.5 * (zr - cr), pm = mr * mr + mi * mi, ps = sr * sr + si * si; PM[k] += pm; PS[k] += ps;
      if (keep) { const f = k * fs / nf; if (f >= 100 && f < 10000) { const bi = Math.floor(24 * Math.log2(f / 100)); if (bi < fb.length) fb[bi] += pm + ps; } } }
    if (keep) frameBands.push(fb); used++;
  }
  const norm = 1 / (used * nf * 0.375 * nf / 4); for (let k = 0; k <= half; k++) { PM[k] *= norm; PS[k] *= norm; }
  const bandPow = (a, b, P) => { let s = 0; const k0 = Math.max(1, Math.round(a * nf / fs)), k1 = Math.min(half, Math.round(b * nf / fs)); for (let k = k0; k < k1; k++) s += P[k]; return s; };
  const PT = new Float64Array(half + 1); for (let k = 0; k <= half; k++) PT[k] = PM[k] + PS[k];
  const total = bandPow(20, Math.min(20000, fs / 2), PT) + 1e-30;
  const octave = OCT_CENTERS.map((c) => (c * Math.SQRT2 < fs / 2 ? powToDb(bandPow(c / Math.SQRT2, c * Math.SQRT2, PT) + 1e-30) : -200));
  const ref = (octave[3] + octave[4] + octave[5] + octave[6]) / 4, octaveRel = octave.map((v) => v - ref);
  const bands = {}; for (const [n, a, b] of BAND_DEFS) bands[n] = b < fs / 2 ? powToDb(bandPow(a, b, PT) / total) : -200;
  let cs = 0, cw = 0; for (let k = 1; k <= half; k++) { const f = k * fs / nf; if (f < 20 || f > 20000) continue; cs += f * PT[k]; cw += PT[k]; }
  const xs = [], ys = []; for (let i = 2; i <= 8; i++) if (octave[i] > -190) { xs.push(i); ys.push(octave[i]); }
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length; let num = 0, den = 0; for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const midPresenceDb = powToDb(bandPow(1000, 4000, PM) / (bandPow(20, Math.min(20000, fs / 2), PM) + 1e-30));
  const disp = [], fMax = Math.min(20000, fs * 0.48);
  for (let i = 0; i < 160; i++) { const f = 20 * Math.pow(fMax / 20, i / 159); disp.push([Math.round(f), +powToDb(bandPow(f * Math.pow(2, -1 / 12), f * Math.pow(2, 1 / 12), PT) / Math.max(1e-9, f * (Math.pow(2, 1 / 12) - Math.pow(2, -1 / 12))) + 1e-30).toFixed(2)]); }
  const lt = new Float64Array(r24.length); frameBands.forEach((fb) => { for (let i = 0; i < fb.length; i++) lt[i] += fb[i]; });
  const ltDb = Array.from(lt, (v) => powToDb(v + 1e-30)), base = (arr, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - 6); j <= Math.min(arr.length - 1, i + 6); j++) if (Math.abs(j - i) > 1) { s += arr[j]; c++; } return s / c; };
  const frDb = frameBands.map((fb) => Array.from(fb, (v) => powToDb(v + 1e-30))), res = [];
  for (let i = 8; i < ltDb.length - 8; i++) { if (r24[i] < 150 || r24[i] > 8000) continue; const ex = ltDb[i] - base(ltDb, i);
    if (ex > 3 && ltDb[i] >= ltDb[i - 1] && ltDb[i] >= ltDb[i + 1]) { let pers = 0; for (const d of frDb) if (d[i] - base(d, i) > 2) pers++;
      const pf = pers / Math.max(1, frDb.length); if (pf > 0.55) res.push({ freq: Math.round(r24[i] * Math.pow(2, 1 / 48)), excessDb: +ex.toFixed(1), persistence: +pf.toFixed(2) }); } }
  res.sort((a, b) => b.excessDb - a.excessDb);
  return { octave, octaveRel, bands, centroid: cw ? cs / cw : 0, tiltDbPerOct: den ? num / den : 0, midPresenceDb, display: disp, resonances: res.slice(0, 4) };
}
function dynamicsStats(chans, fs) {
  const N = chans[0].length, L = chans[0], R = chans[1] || chans[0], fr = Math.max(1, Math.round(fs * 0.005)), nF = Math.floor(N / fr);
  const fHP = new Biquads(butterSections('hp', 100, 2, fs), 1), fS = new Biquads([...butterSections('hp', 5000, 4, fs), ...butterSections('lp', 10000, 4, fs)], 1), fH = new Biquads([...butterSections('hp', 2000, 4, fs), ...butterSections('lp', 5000, 4, fs)], 1);
  const full = new Float32Array(nF), hp = new Float32Array(nF), sib = new Float32Array(nF), har = new Float32Array(nF), a = new Float64Array(fr), b = new Float64Array(fr), c = new Float64Array(fr);
  for (let k = 0; k < nF; k++) { let s0 = 0; for (let i = 0; i < fr; i++) { const m = 0.5 * (L[k * fr + i] + R[k * fr + i]); a[i] = m; b[i] = m; c[i] = m; s0 += m * m; }
    fHP.run(a, fr, 0); fS.run(b, fr, 0); fH.run(c, fr, 0); let s1 = 0, s2 = 0, s3 = 0; for (let i = 0; i < fr; i++) { s1 += a[i] * a[i]; s2 += b[i] * b[i]; s3 += c[i] * c[i]; }
    full[k] = powToDb(s0 / fr); hp[k] = powToDb(s1 / fr); sib[k] = powToDb(s2 / fr); har[k] = powToDb(s3 / fr); }
  const loudRef = nF ? percentileOf(full, 0.95) : -100, act = []; for (let k = 0; k < nF; k++) if (full[k] > loudRef - 30) act.push(k);
  let onsets = 0, last = -1e9; const strengths = [];
  for (let k = 8; k < nF - 1; k++) { if (hp[k] < loudRef - 30) continue; let m = 0; for (let j = k - 8; j < k; j++) m += hp[j]; m /= 8; const o = hp[k] - m;
    if (o > 6 && hp[k] >= hp[k + 1] && k - last > 10) { onsets++; strengths.push(o); last = k; } }
  const sibRel = act.map((k) => sib[k] - full[k]), harRel = act.map((k) => har[k] - full[k]), sibAbs = act.map((k) => sib[k]);
  const bl = Math.round(fs * 0.4), crest = []; for (let o = 0; o + bl <= N; o += bl) { let pk = 0, s = 0; for (let i = o; i < o + bl; i++) { const v = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (v > pk) pk = v; s += (L[i] * L[i] + R[i] * R[i]) / 2; } if (s > 1e-9 * bl) crest.push(20 * Math.log10(pk / Math.sqrt(s / bl))); }
  const durAct = act.length * fr / fs;
  return { onsetRate: durAct > 0 ? onsets / durAct : 0, transientStrengthDb: strengths.length ? percentileOf(strengths, 0.5) : 0, crest400Db: crest.length ? percentileOf(crest, 0.5) : 0,
    sibilanceDb: sibRel.length ? percentileOf(sibRel, 0.99) : -60, sibilanceSpreadDb: sibAbs.length ? percentileOf(sibAbs, 0.99) - percentileOf(sibAbs, 0.5) : 0, harshnessDb: harRel.length ? percentileOf(harRel, 0.9) : -60, dr: ttDR(chans, fs) };
}
function ttDR(chans, fs) { // TT/Pleasurize-style DR: 3 s blocks, top-20% RMS vs 2nd-highest peak
  const bl = Math.round(fs * 3), out = [];
  for (const x of chans) { const rms = [], pk = []; for (let o = 0; o + bl <= x.length; o += bl) { let s = 0, p = 0; for (let i = o; i < o + bl; i++) { const v = x[i]; s += v * v; const av = v < 0 ? -v : v; if (av > p) p = av; } rms.push(Math.sqrt(2 * s / bl)); pk.push(p); }
    if (rms.length < 2) return null; rms.sort((a, b) => b - a); pk.sort((a, b) => b - a); const n = Math.max(1, Math.round(rms.length * 0.2)); let s = 0; for (let i = 0; i < n; i++) s += rms[i] * rms[i]; out.push(20 * Math.log10(pk[1] / Math.sqrt(s / n))); }
  return out.length ? Math.round(out.reduce((a, b) => a + b, 0) / out.length) : null;
}
export function waveformData(chans, cols = 1800) {
  const N = chans[0].length, pk = new Float32Array(cols), rm = new Float32Array(cols);
  for (let c = 0; c < cols; c++) { const a = Math.floor(c * N / cols), b = Math.max(a + 1, Math.floor((c + 1) * N / cols)); let p = 0, s = 0;
    for (let i = a; i < b && i < N; i++) for (const x of chans) { const v = x[i], av = v < 0 ? -v : v; if (av > p) p = av; s += v * v; }
    pk[c] = p; rm[c] = Math.sqrt(s / ((b - a) * chans.length)); }
  return { peak: pk, rms: rm };
}
export function analyzeAudio(chans, fs) {
  const N = chans[0].length, hop = Math.max(1, Math.round(fs / 10)), channels = chans.map(basicStats);
  const loud = measureLoudness(chans, fs), tp = measureTruePeak(chans, fs, hop), stereo = chans.length > 1 ? stereoStats(chans[0], chans[1], fs, hop) : null;
  const spectrum = spectrumStats(chans, fs), dyn = dynamicsStats(chans, fs), wave = waveformData(chans);
  const samplePeakDb = Math.max(...channels.map((c) => c.peakDb)), rmsDb = 10 * Math.log10(channels.reduce((s, c) => s + Math.pow(10, c.rmsDb / 10), 0) / channels.length + 1e-30);
  return { fs, channelsCount: chans.length, frames: N, duration: N / fs, channels, loudness: loud, truePeak: tp, samplePeakDb, rmsDb, crestDb: samplePeakDb - rmsDb,
    plr: isFinite(loud.integrated) ? tp.dbtp - loud.integrated : 0, stereo, spectrum, dynamics: dyn, wave, clipRuns: channels.reduce((s, c) => s + c.clipRuns, 0) };
}
// deterministic, rule-based problem detection against the selected genre's tonal target (no AI)
export function detectProblems(an, genre) {
  const P = [], add = (id, sev, title, detail, fix) => P.push({ id, severity: sev, title, detail, fix });
  const t = genre.targetRel, d = an.spectrum.octaveRel.map((v, i) => v - t[i]), f1 = (v) => (v > 0 ? '+' : '') + v.toFixed(1);
  if (!isFinite(an.loudness.integrated)) { add('silent', 'critical', 'Audio is silent', 'No measurable programme loudness.', 'Check the file.'); return P; }
  if (an.clipRuns > 0) add('clipping', an.clipRuns > 50 ? 'critical' : 'warn', 'Clipping in source', an.clipRuns + ' flat-topped peak runs detected (sample peak ' + an.samplePeakDb.toFixed(2) + ' dBFS).', 'Clipped peaks cannot be fully restored; request an unclipped mix if possible. No extra hard clipping is added.');
  if (an.truePeak.dbtp > 0) add('overs', 'warn', 'Inter-sample overs in source', 'True peak ' + an.truePeak.dbtp.toFixed(2) + ' dBTP.', 'Handled by gain staging and the true-peak limiter.');
  const dc = Math.max(...an.channels.map((c) => c.dcDb)); if (dc > -60) add('dc', 'warn', 'DC offset', 'DC offset ' + dc.toFixed(1) + ' dBFS.', 'Removed in pre-processing.');
  if (d[0] > 4) add('sub', 'warn', 'Excessive sub-bass', '31 Hz octave ' + f1(d[0]) + ' dB vs ' + genre.name + ' target.', 'Low-band compression and gentle low-shelf correction.');
  const bass = (d[1] + d[2]) / 2, mud = (d[3] + d[4]) / 2, harsh = (d[6] + d[7]) / 2;
  if (bass > 3.5) add('bass', 'warn', 'Excessive bass', '63-125 Hz ' + f1(bass) + ' dB vs target.', 'Corrective EQ and dynamic low-end control.');
  if (bass < -4) add('thin', 'info', 'Thin low end', '63-125 Hz ' + f1(bass) + ' dB vs target.', 'Gentle low-end weight added.');
  if (mud > 2.5) add('mud', 'warn', 'Muddy low-mids', '250-500 Hz ' + f1(mud) + ' dB vs target.', 'Broad low-mid cut.');
  if (harsh > 2.5 || an.dynamics.harshnessDb > -3) add('harsh', 'warn', 'Harsh upper mids', '2-4 kHz ' + f1(harsh) + ' dB vs target; harsh-band peaks ' + an.dynamics.harshnessDb.toFixed(1) + ' dB re full band.', 'Dynamic harshness control and corrective cut.');
  if (an.dynamics.sibilanceDb > -4 && an.dynamics.sibilanceSpreadDb > 14) add('sibilance', 'warn', 'Excessive sibilance', '5-10 kHz bursts reach ' + an.dynamics.sibilanceDb.toFixed(1) + ' dB re full band.', 'De-esser range increased.');
  if (an.spectrum.midPresenceDb < -15) add('presence', 'info', 'Weak vocal presence', 'Mid-channel 1-4 kHz energy ' + an.spectrum.midPresenceDb.toFixed(1) + ' dB re mid total.', 'Mid-channel clarity lift.');
  if (Math.abs(an.spectrum.tiltDbPerOct - genre.tilt) > 1.6) add('tilt', 'info', an.spectrum.tiltDbPerOct > genre.tilt ? 'Bright overall balance' : 'Dark overall balance', 'Spectral tilt ' + an.spectrum.tiltDbPerOct.toFixed(2) + ' dB/oct (genre about ' + genre.tilt.toFixed(1) + ').', 'Broad tonal correction toward the genre target.');
  for (const r of an.spectrum.resonances) if (r.excessDb > 4) add('res' + r.freq, 'info', 'Resonance near ' + r.freq + ' Hz', 'Persistent narrow peak +' + r.excessDb + ' dB (' + Math.round(r.persistence * 100) + '% of the track).', 'Narrow corrective cut.');
  if (an.stereo) { const s = an.stereo;
    if (Math.abs(s.balanceDb) > 1) add('balance', 'warn', 'L/R imbalance', 'Left is ' + f1(s.balanceDb) + ' dB relative to right.', 'Balance correction in the stereo stage.');
    if (s.correlation < 0.15) add('phase', s.correlation < 0 ? 'critical' : 'warn', 'Phase / mono-compatibility risk', 'Correlation ' + s.correlation.toFixed(2) + ', mono fold-down loses ' + (an.loudness.integrated - s.monoFoldI).toFixed(1) + ' dB.', 'Stereo widening disabled.');
    if (s.lowCorrelation < 0.8 && s.lowSideToMidDb > -15) add('basswide', 'warn', 'Wide / out-of-phase bass', 'Low-band correlation ' + s.lowCorrelation.toFixed(2) + '.', 'Bass mono below the crossover.'); }
  if (an.plr < 8 || (an.loudness.lra < 2.5 && an.loudness.integrated > -11)) add('squashed', 'warn', 'Already heavily compressed', 'PLR ' + an.plr.toFixed(1) + ' dB, LRA ' + an.loudness.lra.toFixed(1) + ' LU.', 'Dynamics processing reduced; limiter kept light.');
  if (an.loudness.integrated < -30) add('quiet', 'info', 'Very quiet source', 'Integrated ' + an.loudness.integrated.toFixed(1) + ' LUFS.', 'Gain staging normalises the level before processing.');
  return P;
}
