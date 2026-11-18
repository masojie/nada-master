// tests/lib/signals.mjs
// Generator sinyal uji sintetis yang deterministik. Tidak butuh file audio dari luar.
//
// Semua fungsi mengembalikan array kanal Float32Array: [L, R] (atau [M] untuk mono).
// Seed yang sama selalu menghasilkan sinyal yang sama persis, di mesin apa pun,
// karena hanya memakai aritmetika Math.* dan PRNG mulberry32.
//
// Pengukur di bawah (peakDb, rmsDb, ...) sengaja ditulis ulang di sini dan tidak mengimpor engine,
// supaya tes tidak memakai kode yang sedang diuji sebagai alat ukur.
import { createHash } from 'crypto';

export const dbToLin = (db) => Math.pow(10, db / 20);
export const linToDb = (x) => (x > 1e-30 ? 20 * Math.log10(x) : -600);
const frames = (fs, sec) => Math.max(1, Math.round(fs * sec));
const alloc = (n, ch) => Array.from({ length: ch }, () => new Float32Array(n));

// PRNG mulberry32: cepat, kecil, dan seed-nya jelas.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- generator dasar

export function silence(fs, sec, ch = 2) { return alloc(frames(fs, sec), ch); }

export function dcOffset(fs, sec, level, ch = 2) {
  const out = alloc(frames(fs, sec), ch);
  for (const x of out) x.fill(level);
  return out;
}

export function sine(fs, sec, f, peakDb = -6, ch = 2) {
  const n = frames(fs, sec), a = dbToLin(peakDb), out = alloc(n, ch);
  for (let i = 0; i < n; i++) {
    const v = a * Math.sin((2 * Math.PI * f * i) / fs);
    for (let c = 0; c < ch; c++) out[c][i] = v;
  }
  return out;
}

// Sweep sinus logaritmik f0 -> f1 selama sec detik.
export function sweep(fs, sec, f0, f1, peakDb = -6, ch = 2) {
  const n = frames(fs, sec), a = dbToLin(peakDb), out = alloc(n, ch), T = n / fs, k = Math.log(f1 / f0);
  for (let i = 0; i < n; i++) {
    const t = i / fs, phase = (2 * Math.PI * f0 * T / k) * (Math.exp((k * t) / T) - 1), v = a * Math.sin(phase);
    for (let c = 0; c < ch; c++) out[c][i] = v;
  }
  return out;
}

// Pink noise (filter Paul Kellet), tiap kanal memakai seed berbeda sehingga tidak berkorelasi.
// Level dinormalkan ke RMS yang diminta.
export function pinkNoise(fs, sec, rmsTargetDb = -20, seed = 11, ch = 2) {
  const n = frames(fs, sec), out = alloc(n, ch);
  for (let c = 0; c < ch; c++) {
    const r = rng(seed + c * 7919);
    let b0 = 0, b1 = 0, b2 = 0, sum = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      const p = b0 + b1 + b2 + w * 0.1848;
      out[c][i] = p; sum += p * p;
    }
    const g = dbToLin(rmsTargetDb) / Math.sqrt(sum / n + 1e-30);
    for (let i = 0; i < n; i++) out[c][i] *= g;
  }
  return out;
}

// Satu sampel impuls di posisi atSec dengan amplitudo linear amp, di semua kanal.
export function impulse(fs, sec, atSec, amp = 1, ch = 2) {
  const out = alloc(frames(fs, sec), ch), i = Math.min(out[0].length - 1, Math.max(0, Math.round(atSec * fs)));
  for (const x of out) x[i] = amp;
  return out;
}

// Gain lalu potong keras di +-1 (meniru file yang sudah clipping dari mixdown).
export function driveClip(chans, gainDb) {
  const g = dbToLin(gainDb);
  return chans.map((x) => Float32Array.from(x, (v) => Math.max(-1, Math.min(1, v * g))));
}

// ---------------------------------------------------------------- musik tiruan

const STYLES = {
  pop:    { bpm: 100, kick: 0.9, kickEvery: 2, bass: 0.5, pad: 0.05, vocal: 0.22, hat: 0.07, hatDiv: 2 },
  ballad: { bpm: 68,  kick: 0.0, kickEvery: 2, bass: 0.35, pad: 0.09, vocal: 0.3,  hat: 0.02, hatDiv: 1 },
  dance:  { bpm: 128, kick: 1.0, kickEvery: 1, bass: 0.6, pad: 0.06, vocal: 0.0,  hat: 0.12, hatDiv: 4 },
};

// Campuran tiruan: kick (sweep sinus), bass, pad akor (stereo lebar), vokal berformant, hi-hat noise.
// Cukup kaya untuk menggerakkan EQ, kompresor, multiband, limiter, dan meter, tetapi 100% sintetis.
// peakDb = puncak sampel hasil akhir (dinormalkan).
export function music(fs, sec, o = {}) {
  const { seed = 7, style = 'pop', peakDb = -3, ch = 2 } = o, S = STYLES[style] || STYLES.pop;
  const n = frames(fs, sec), r = rng(seed), out = alloc(n, 2), beat = 60 / S.bpm;
  const chord = [110, 220, 261.63, 329.63, 392], bassLine = [55, 55, 65.41, 49];
  const formants = [[700, 1], [1200, 0.7], [2600, 0.35]];
  const vocalAmp = (f) => { let a = 0.05; for (const [fc, g] of formants) a += g * Math.exp(-Math.pow((f - fc) / (fc * 0.18), 2)); return a; };
  let hatPrev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fs, beatIdx = Math.floor(t / beat), bt = t - beatIdx * beat;
    // kick pada beat genap (atau tiap beat untuk dance)
    const kickOn = beatIdx % S.kickEvery === 0 ? 1 : 0;
    const kph = 2 * Math.PI * (45 * bt + 3 * (1 - Math.exp(-30 * bt)));
    const kick = S.kick * kickOn * Math.exp(-bt * 12) * Math.sin(kph);
    // bass: nada berganti tiap beat, attack cepat supaya tidak klik
    const bf = bassLine[beatIdx % 4], bEnv = Math.min(1, bt * 200) * (0.55 + 0.45 * Math.exp(-bt * 3));
    const bass = S.bass * bEnv * (Math.sin(2 * Math.PI * bf * t) + 0.3 * Math.sin(4 * Math.PI * bf * t));
    // pad akor: L dan R sedikit berbeda frekuensi (lebar stereo alami)
    const padEnv = 0.55 + 0.45 * Math.sin((2 * Math.PI * t) / (beat * 8));
    let padL = 0, padR = 0;
    for (let k = 0; k < chord.length; k++) {
      padL += Math.sin(2 * Math.PI * chord[k] * 1.0035 * t + k);
      padR += Math.sin(2 * Math.PI * chord[k] * 0.9965 * t - k);
    }
    padL *= S.pad * padEnv; padR *= S.pad * padEnv;
    // vokal: deret harmonik 220 Hz dengan vibrato dan bentuk formant, aktif 70% dari tiap 2 beat
    let voc = 0;
    if (S.vocal > 0) {
      const gate = (t / (beat * 2)) % 1 < 0.7 ? Math.min(1, ((t / (beat * 2)) % 1) * 20) : 0;
      if (gate > 0) {
        const f0 = 220 * (1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * t));
        for (let h = 1; h <= 10; h++) voc += vocalAmp(f0 * h) * Math.sin(2 * Math.PI * f0 * h * t) / h;
        voc *= S.vocal * gate;
      }
    }
    // hi-hat: noise dengan turunan pertama (highpass kasar), terpicu pada pembagian ketukan
    const sub = beat / S.hatDiv, hp = (t % sub), hatEnv = Math.exp(-hp * 60) * (Math.floor(t / sub) % 2 === 1 || S.hatDiv === 1 ? 1 : 0.4);
    const w = r() * 2 - 1, hatRaw = (w - hatPrev) * 0.5; hatPrev = w;
    const hat = S.hat * hatEnv * hatRaw;
    out[0][i] = kick + bass + padL + voc + hat * 0.6;
    out[1][i] = kick + bass + padR + voc + hat * 0.9;
  }
  const mx = peak(out) || 1, g = dbToLin(peakDb) / mx;
  for (const x of out) for (let i = 0; i < n; i++) x[i] *= g;
  if (ch === 1) { const m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = 0.5 * (out[0][i] + out[1][i]); const mp = peak([m]) || 1, g2 = dbToLin(peakDb) / mp; for (let i = 0; i < n; i++) m[i] *= g2; return [m]; }
  return out;
}

// ---------------------------------------------------------------- utilitas dan pengukur

export const copy = (chans) => chans.map((x) => Float32Array.from(x));
export const scaleDb = (chans, db) => { const g = dbToLin(db); return chans.map((x) => Float32Array.from(x, (v) => v * g)); };
export const source = (chans, fs) => ({ chans, fs });

export function peak(chans) {
  let m = 0;
  for (const x of chans) for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; }
  return m;
}
export const peakDb = (chans) => linToDb(peak(chans));

export function rmsDb(chans) {
  let s = 0, n = 0;
  for (const x of chans) { for (let i = 0; i < x.length; i++) s += x[i] * x[i]; n += x.length; }
  return linToDb(Math.sqrt(s / Math.max(1, n)));
}

export function allFinite(chans) {
  for (const x of chans) for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) return false;
  return true;
}

export function maxAbsDiff(a, b) {
  let m = 0;
  for (let c = 0; c < a.length; c++) for (let i = 0; i < a[c].length; i++) { const d = Math.abs(a[c][i] - b[c][i]); if (d > m) m = d; }
  return m;
}

// Sidik jari isi audio, untuk uji determinisme (hasil identik bit demi bit).
export function md5(chans) {
  const h = createHash('md5');
  for (const x of chans) h.update(Buffer.from(x.buffer, x.byteOffset, x.byteLength));
  return h.digest('hex');
}

// ---------------------------------------------------------------- true peak independen

// Sinus fs/4 dengan fase 45 derajat: semua sampel bernilai +-0.7071 x amplitudo, padahal puncak
// gelombang sebenarnya 1.0 x amplitudo (titik tengah antar sampel). Ini rangsangan klasik
// "inter-sample peak". peakDb adalah puncak SAMPEL, true peak-nya 3.01 dB lebih tinggi.
export function interSamplePeak(fs, sec, peakDb = -1, ch = 2) {
  const n = frames(fs, sec), a = dbToLin(peakDb) * Math.SQRT2, out = alloc(n, ch);
  for (let i = 0; i < n; i++) { const v = a * Math.sin((Math.PI / 2) * i + Math.PI / 4); for (let c = 0; c < ch; c++) out[c][i] = v; }
  return out;
}

const TP_OS = 4, TP_HALF = 24;
let tpKernel = null;
function besselI0(x) { let s = 1, t = 1; for (let k = 1; k < 60; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; if (t < 1e-14 * s) break; } return s; }
function kernel() {
  if (tpKernel) return tpKernel;
  const beta = 8, norm = besselI0(beta);
  tpKernel = [];
  for (let ph = 1; ph < TP_OS; ph++) {
    const frac = ph / TP_OS, taps = new Float64Array(2 * TP_HALF);
    for (let j = 0; j < 2 * TP_HALF; j++) {
      const d = j - (TP_HALF - 1), u = frac - d, w = Math.abs(u) < TP_HALF ? besselI0(beta * Math.sqrt(1 - (u / TP_HALF) * (u / TP_HALF))) / norm : 0;
      taps[j] = (Math.abs(u) < 1e-12 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u)) * w;
    }
    tpKernel.push(taps);
  }
  return tpKernel;
}

// True peak (dBTP) lewat interpolasi sinc berjendela Kaiser 4x. Ditulis terpisah dari meter di engine
// supaya bisa dipakai sebagai pembanding. Hanya menghitung di sekitar sampel yang cukup besar (efisien).
// margin = jumlah sampel di awal dan akhir yang diabaikan (sinyal uji yang dipotong mendadak
// menghasilkan overshoot Gibbs di tepinya; untuk uji jawaban-pasti pakai margin, misalnya 2048).
export function truePeakDb(chans, margin = 0) {
  const K = kernel();
  let sp = 0;
  for (const x of chans) for (let i = margin; i < x.length - margin; i++) { const a = Math.abs(x[i]); if (a > sp) sp = a; }
  if (sp === 0) return -600;
  let best = sp;
  const gate = sp * 0.35;
  for (const x of chans) {
    const n = x.length;
    for (let i = margin; i < n - 1 - margin; i++) {
      if (Math.abs(x[i]) < gate && Math.abs(x[i + 1]) < gate) continue;
      for (let p = 0; p < TP_OS - 1; p++) {
        const taps = K[p];
        let s = 0;
        for (let j = 0; j < 2 * TP_HALF; j++) { const idx = i - TP_HALF + 1 + j; if (idx >= 0 && idx < n) s += x[idx] * taps[j]; }
        const a = Math.abs(s);
        if (a > best) best = a;
      }
    }
  }
  return linToDb(best);
}
