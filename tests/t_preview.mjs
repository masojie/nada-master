// tests/t_preview.mjs - jalur preview cepat vs mesin akurat (butuh --expose-gc untuk tes alokasi; dijalankan ulang otomatis)
// test-preview.mjs: node --expose-gc test-preview.mjs
// Membandingkan jalur cepat dengan mesin akurat (src/engine) pada tahap yang sama, lalu menguji kehalusan, alokasi, dan beban CPU.
import { PreviewCore, DEFAULT_PARAMS, MAXS } from '../src/preview/preview-core.js';
import { buildParams } from '../src/preview/preview-params.js';
import { BASE_FULL } from '../src/engine/settings.js';
import { cloneDeep, makeRng, dbToLin } from '../src/engine/util.js';
import { PreStage, EQStage, CompStage, runBlockStage } from '../src/engine/modules.js';
import { runLimiter } from '../src/engine/limiter.js';
import { integratedLufs } from '../src/engine/loudness.js';
import { designBiquad, Biquads } from '../src/engine/biquad.js';
import { spawnSync } from 'child_process';
if (!global.gc) { const r = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit' }); process.exit(r.status == null ? 1 : r.status); }

const fs = 48000, BS = 128; let fails = 0;
const ok = (name, cond, info = '') => { console.log(`${cond ? 'PASS ' : 'FAIL '} ${name}${info ? '  ' + info : ''}`); if (!cond) fails++; };
const fmt = (x, d = 3) => (+x).toFixed(d);

// sinyal uji mirip musik: kick 60 Hz meluruh, hat noise, akor dengan modulasi, bass; stereo dengan sedikit beda L/R
function music(sec, seed = 1) {
  const N = Math.round(sec * fs), L = new Float32Array(N), R = new Float32Array(N), rng = makeRng(seed);
  for (let i = 0; i < N; i++) {
    const t = i / fs, beat = (t * 2) % 1, kick = Math.sin(2 * Math.PI * (45 + 90 * Math.exp(-beat * 18)) * beat) * Math.exp(-beat * 7) * 0.8;
    const hat = (rng() * 2 - 1) * Math.exp(-((t * 4) % 1) * 25) * 0.25, ch = 0.12 * (Math.sin(2 * Math.PI * 261.6 * t) + Math.sin(2 * Math.PI * 329.6 * t) + Math.sin(2 * Math.PI * 392 * t)) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.4 * t));
    const bass = 0.3 * Math.sin(2 * Math.PI * 55 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.25 * t)), nz = (rng() * 2 - 1) * 0.03;
    L[i] = kick + hat + ch + bass + nz; R[i] = kick + 0.8 * hat + 0.9 * ch + bass + (rng() * 2 - 1) * 0.03;
  }
  return [L, R];
}
const iL = new Float64Array(BS), iR = new Float64Array(BS), oL = new Float64Array(BS), oR = new Float64Array(BS);
function runCore(core, X, onBlock) {
  const N = X[0].length, outL = new Float64Array(N), outR = new Float64Array(N);
  for (let r = 0, b = 0; r < N; r += BS, b++) {
    const n = Math.min(BS, N - r); if (n < BS) break;
    if (onBlock) onBlock(b, core);
    for (let i = 0; i < n; i++) { iL[i] = X[0][r + i]; iR[i] = X[1][r + i]; }
    core.process(iL, iR, oL, oR, n); outL.set(oL, r); outR.set(oR, r);
  }
  return [outL, outR];
}
const maxDiff = (a, b, off, n) => { let m = 0; for (let i = 0; i < n; i++) { const d = Math.abs(a[i + off] - b[i]); if (d > m) m = d; } return m; };
const rmsDb = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return 10 * Math.log10(s / x.length + 1e-30); };
const S0 = () => { const S = cloneDeep(BASE_FULL); S.pre.bypass = true; S.eq.bypass = true; S.comp.bypass = true; S.lim.bypass = true; return S; };
const X = music(20), N = X[0].length, trim = Math.floor(N / BS) * BS;
const bands = [{ on: true, type: 'hp', f: 30, slope: 24, ch: 'stereo' }, { on: true, type: 'bell', f: 250, q: 1, g: -3, ch: 'stereo' }, { on: true, type: 'bell', f: 3000, q: 1.4, g: 2.5, ch: 'mid' },
  { on: true, type: 'highshelf', f: 9000, q: 0.7, g: 2, ch: 'side' }, { on: true, type: 'lowshelf', f: 100, q: 0.7, g: 1.5, ch: 'stereo' }, { on: true, type: 'bell', f: 1200, q: 2, g: -2, ch: 'stereo' }];
const refRun = (mod) => { const w = X.map((c) => new Float32Array(c)); runBlockStage(mod, w); return w; };
const mk = (S, opts) => { const { params } = buildParams(S, fs, opts); return new PreviewCore(fs, params); };

console.log('== 1. Kesetaraan per tahap terhadap mesin akurat (toleransi float32 mesin: 1e-6) ==');
{ // Pre
  const S = S0(); S.pre = { bypass: false, inputGainDb: 6, autoHeadroom: false, refLufs: -18, dcRemove: false, rumble: true, rumbleHz: 25, rumbleSlope: 24 };
  const ref = refRun(new PreStage(S.pre, fs, 2, null)), core = mk(S), y = runCore(core, X), L = core.L;
  ok('Pre (gain + rumble 24 dB/okt) sama dengan PreStage', maxDiff(y[0], ref[0], L, trim - L - BS) < 1e-6 && maxDiff(y[1], ref[1], L, trim - L - BS) < 1e-6, `selisih maks ${maxDiff(y[0], ref[0], L, trim - L - BS).toExponential(2)}`);
}
{ // EQ
  const S = S0(); S.eq = { bypass: false, phase: 'minimum', bands };
  const ref = refRun(new EQStage(S.eq, fs, 2)), core = mk(S), y = runCore(core, X), L = core.L, d = Math.max(maxDiff(y[0], ref[0], L, trim - L - BS), maxDiff(y[1], ref[1], L, trim - L - BS));
  ok('EQ (6 pita: stereo, mid-saja, side-saja) sama dengan EQStage', d < 1e-6, `selisih maks ${d.toExponential(2)}`);
}
const CP = { bypass: false, autoThr: false, thrDb: -24, ratio: 3, attackMs: 20, releaseMs: 150, autoRelease: true, kneeDb: 6, makeupDb: 2, mix: 100, scHpfHz: 90, rmsMs: 10 };
{ // Kompresor
  const S = S0(); S.comp = CP; const ref = refRun(new CompStage(CP, fs, 2, CP.thrDb)), core = mk(S), y = runCore(core, X), L = core.L, d = Math.max(maxDiff(y[0], ref[0], L, trim - L - BS), maxDiff(y[1], ref[1], L, trim - L - BS));
  ok('Kompresor bus sama dengan CompStage (ambang tetap)', d < 1e-6, `selisih maks ${d.toExponential(2)}`);
}
{ // Limiter
  const S = S0(); S.lim = { bypass: false, ceilingDb: -1, lookaheadMs: 2, releaseMs: 100, autoRelease: true, style: 'balanced', tpDetect: false, driveDb: 0, trimDb: 0 };
  const g = 12, core = mk(S, { outGainDb: g }), y = runCore(core, X), peak = Math.max(...[y[0], y[1]].map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0))), ceil = dbToLin(-1.02);
  ok('Limiter: sample-peak tidak melewati ceiling (-1,02 dB) pada sinyal +12 dB', peak <= ceil + 1e-9, `puncak ${fmt(20 * Math.log10(peak), 3)} dBFS, klamp pengaman ${core.clamps}`);
  const w = X.map((c) => { const a = new Float32Array(c.length); const k = dbToLin(g); for (let i = 0; i < a.length; i++) a[i] = c[i] * k; return a; });
  const r = runLimiter(w, S.lim, fs, {}), L = core.L, seg = (a) => a.subarray(48000, trim - 48000);
  const dd = Math.abs(rmsDb(seg(y[0])) - rmsDb(seg(w[0])));
  ok('Limiter: tingkat RMS dalam 1 dB dari limiter mesin', dd < 1, `selisih ${fmt(dd)} dB; GR maks mesin ${r.maxGrDb} dB`);
}

console.log('== 2. Rantai penuh vs rantai mesin (Pre, EQ, kompresor, gain, limiter) ==');
const full = (() => {
  const S = S0(); S.pre = { bypass: false, inputGainDb: 3, autoHeadroom: false, refLufs: -18, dcRemove: false, rumble: true, rumbleHz: 25, rumbleSlope: 24 }; S.eq = { bypass: false, phase: 'minimum', bands }; S.comp = CP;
  S.lim = { bypass: false, ceilingDb: -1, lookaheadMs: 2, releaseMs: 100, autoRelease: true, style: 'balanced', tpDetect: false, driveDb: 0, trimDb: 0 }; return S;
})();
const OUTG = 6;
{
  const w = X.map((c) => new Float32Array(c)); runBlockStage(new PreStage(full.pre, fs, 2, null), w); runBlockStage(new EQStage(full.eq, fs, 2), w); runBlockStage(new CompStage(CP, fs, 2, CP.thrDb), w);
  const k = dbToLin(OUTG); for (const c of w) for (let i = 0; i < c.length; i++) c[i] *= k; runLimiter(w, full.lim, fs, {});
  const core = mk(full, { outGainDb: OUTG }), y = runCore(core, X), L = core.L, a = (c) => Float32Array.from(c.subarray(L + 48000, trim - 48000)), b = (c) => c.subarray(48000, trim - 48000 - L);
  const lufA = integratedLufs([a(y[0]), a(y[1])], fs), lufB = integratedLufs([b(w[0]), b(w[1])], fs);
  ok('Loudness terpadu dalam 1 LU dari mesin', Math.abs(lufA - lufB) < 1, `preview ${fmt(lufA, 2)} LUFS, mesin ${fmt(lufB, 2)} LUFS`);
  let worst = 0, line = [];
  for (const f of [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]) {
    const bp = (x) => { const z = Float64Array.from(x); new Biquads([designBiquad('bp', f, 1.414, 0, fs)], 1).run(z, z.length, 0); return rmsDb(z); };
    const dd = Math.abs(bp(a(y[0])) - bp(b(w[0]))); line.push(`${f}:${fmt(dd, 2)}`); if (dd > worst) worst = dd;
  }
  ok('Respons per oktaf dalam 1 dB dari mesin', worst < 1, `selisih dB per oktaf ${line.join(' ')}`);
}

console.log('== 3. Kehalusan saat knob digeser (klik) ==');
function randParams(rng, i, mode = 'full') {
  const S = cloneDeep(full), rb = (a, b) => a + (b - a) * rng();
  S.eq.bands = bands.map((b0) => ({ ...b0, f: b0.f * Math.pow(2, rb(-0.7, 0.7)), g: (b0.g || 0) + rb(-9, 9) }));
  S.comp.thrDb = rb(-40, -10); S.comp.ratio = rb(1.2, 6); S.comp.makeupDb = rb(-3, 6); S.comp.mix = rb(0, 100); S.pre.inputGainDb = rb(-6, 6); S.lim.ceilingDb = rb(-3, -0.3); S.lim.releaseMs = rb(30, 250);
  if (i % 11 === 5) S.comp.bypass = !S.comp.bypass; if (i % 13 === 4) S.lim.bypass = !S.lim.bypass; if (i % 7 === 3) S.eq.bypass = !S.eq.bypass;
  if (mode === 'eq') { S.comp.bypass = true; S.lim.bypass = true; S.eq.bypass = false; }
  if (mode === 'dyn') { S.eq.bypass = true; S.pre.bypass = true; }
  return buildParams(S, fs, { outGainDb: mode === 'eq' ? 0 : rb(0, 9) }).params;
}
// Perubahan parameter dilakukan di awal blok; keluarannya tertunda L sampel (lookahead), jadi klik muncul di posisi L dan L+1 dalam blok (dan 0, 1 untuk wet limiter).
function clickTest(mode, opts) {
  const rng = makeRng(7), pre = []; for (let i = 0; i < 400; i++) pre.push(randParams(rng, i, mode));
  const sec = 10, Nn = sec * fs, x = [new Float32Array(Nn), new Float32Array(Nn)]; for (let i = 0; i < Nn; i++) { x[0][i] = x[1][i] = 0.5 * Math.sin(2 * Math.PI * 100 * i / fs); }
  const core = new PreviewCore(fs, pre[0], opts); let nb = 0; const L = core.L;
  const y = runCore(core, x, (b, c) => { if (b % 7 === 0) { c.setParams(pre[(b / 7) % pre.length | 0]); nb++; } });
  let bMax = 0, iMax = 0, nonFinite = 0;
  for (let n = 2 + fs / 2; n < y[0].length; n++) { const d2 = Math.abs(y[0][n] - 2 * y[0][n - 1] + y[0][n - 2]); if (!isFinite(d2)) { nonFinite++; continue; } const pos = n % BS; if (pos === 0 || pos === 1 || pos === L % BS || pos === (L + 1) % BS) { if (d2 > bMax) bMax = d2; } else if (d2 > iMax) iMax = d2; }
  return { bMax, iMax, ratio: bMax / Math.max(iMax, 1e-12), changes: nb, nonFinite, nanResets: core.nan };
}
{
  const bound = 0.5 * 4 * Math.pow(2 * Math.PI * 100 / fs, 2); // d2 maksimum sinus 100 Hz bila gain sampai 4x (12 dB)
  for (const mode of ['eq', 'dyn', 'full']) {
    const r = clickTest(mode);
    ok(`Tanpa klik, mode ${mode}: semua knob berubah acak tiap 7 blok (19 ms)`, r.ratio < 2 && r.nonFinite === 0 && r.nanResets === 0, `d2 titik ganti ${r.bMax.toExponential(2)} vs d2 lain ${r.iMax.toExponential(2)}, rasio ${fmt(r.ratio, 2)}, ${r.changes} perubahan, batas sinus murni ${bound.toExponential(1)}`);
  }
  const r = clickTest('eq'), c = clickTest('eq', { noSmooth: true });
  ok('Kontrol negatif: koefisien melompat tanpa penghalusan memang terdeteksi sebagai klik', c.bMax > 20 * r.bMax, `d2 titik ganti ${c.bMax.toExponential(2)} (tanpa penghalusan) vs ${r.bMax.toExponential(2)} (dengan)`);
}

console.log('== 4. Ketahanan ==');
{
  const core = new PreviewCore(fs, buildParams(full, fs, { outGainDb: 6 }).params), ones = new Float64Array(BS).fill(1), z = new Float64Array(BS), nan = new Float64Array(BS).fill(NaN), big = new Float64Array(BS).fill(1e6);
  for (const blk of [z, big, nan, z, ones]) core.process(blk, blk, oL, oR, BS);
  let fin = true; for (let r = 0; r < 200; r++) { core.process(ones, ones, oL, oR, BS); for (let i = 0; i < BS; i++) if (!isFinite(oL[i]) || !isFinite(oR[i])) fin = false; }
  ok('Pulih dari NaN dan input 1e6 tanpa keluaran tak hingga', fin && core.nan >= 1, `reset NaN ${core.nan} kali`);
}

console.log('== 5. Alokasi di jalur audio ==');
{
  const rng = makeRng(3), pre = []; for (let i = 0; i < 50; i++) pre.push(randParams(rng, i));
  const core = new PreviewCore(fs, pre[0]), blk = Float64Array.from({ length: BS }, (_, i) => 0.4 * Math.sin(i * 0.3));
  for (let b = 0; b < 20000; b++) { if (b % 10 === 0) core.setParams(pre[(b / 10) % 50 | 0]); core.process(blk, blk, oL, oR, BS); }
  if (global.gc) { global.gc(); const h0 = process.memoryUsage().heapUsed; for (let b = 0; b < 300000; b++) { if (b % 10 === 0) core.setParams(pre[(b / 10) % 50 | 0]); core.process(blk, blk, oL, oR, BS); } global.gc(); const dh = process.memoryUsage().heapUsed - h0;
    ok('Heap tidak tumbuh setelah 300.000 blok (13 menit audio) dengan perubahan parameter', dh < 1.5e6, `selisih heap ${(dh / 1024).toFixed(0)} KiB`); } else console.log('LEWAT  tes alokasi (jalankan dengan node --expose-gc)');
}

console.log('== 6. Beban CPU per blok (Node, 1 vCPU sandbox) ==');
{
  const rng = makeRng(5), P = randParams(rng, 1); P.eqLR = P.eqLR.slice(0, MAXS); const core = new PreviewCore(fs, buildParams(full, fs, { outGainDb: 6 }).params), blk = Float64Array.from({ length: BS }, (_, i) => 0.5 * Math.sin(i * 0.2) + 0.2 * Math.sin(i * 1.7));
  const blk2 = Float64Array.from({ length: BS }, (_, i) => 0.5 * Math.cos(i * 0.21));
  for (let b = 0; b < 20000; b++) core.process(blk, blk2, oL, oR, BS);
  const NB = 200000, t0 = process.hrtime.bigint(); for (let b = 0; b < NB; b++) core.process(blk, blk2, oL, oR, BS); const ms = Number(process.hrtime.bigint() - t0) / 1e6 / NB, budget = BS / fs * 1000;
  const act = core.eq.act.reduce((a, b) => a + b, 0) + core.mid.act.reduce((a, b) => a + b, 0) + core.side.act.reduce((a, b) => a + b, 0) + core.pre.act.reduce((a, b) => a + b, 0);
  console.log(`      ${act} seksi biquad aktif + kompresor + limiter: ${ms.toFixed(4)} ms/blok, jatah ${budget.toFixed(3)} ms => ${(100 * ms / budget).toFixed(1)}% jatah`);
  console.log(`      perkiraan HP lebih lambat 2,4x (RFC 2.1): ${(100 * ms * 2.4 / budget).toFixed(1)}% | stres 4x: ${(100 * ms * 4 / budget).toFixed(1)}%`);
  ok('Anggaran RFC: rata-rata di bawah 50% jatah blok bahkan pada 4x lebih lambat', ms * 4 / budget < 0.5);
}
console.log(fails ? `\n${fails} tes GAGAL` : '\nSemua tes lulus'); process.exit(fails ? 1 : 0);
