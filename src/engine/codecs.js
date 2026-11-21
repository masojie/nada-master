// codecs.js — WAV (PCM 8/16/24/32, float32/64, EXTENSIBLE) and AIFF/AIFF-C readers, WAV writer, MP3 header probe
function str4(dv, o) { return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)); }
export function detectFormat(u8) {
  const s = String.fromCharCode(...u8.subarray(0, 12));
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WAVE') return 'wav';
  if (s.startsWith('FORM') && (s.slice(8, 12) === 'AIFF' || s.slice(8, 12) === 'AIFC')) return 'aiff';
  if (s.startsWith('fLaC')) return 'flac';
  if (s.startsWith('ID3') && findFlacAfterId3(u8) >= 0) return 'flac';
  if (s.startsWith('ID3') || (u8[0] === 0xFF && (u8[1] & 0xE0) === 0xE0)) return 'mp3';
  return 'unknown';
}
export function id3Size(u8) { if (u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) return 10 + ((u8[6] & 127) << 21 | (u8[7] & 127) << 14 | (u8[8] & 127) << 7 | (u8[9] & 127)) + ((u8[5] & 0x10) ? 10 : 0); return 0; }
function findFlacAfterId3(u8) { const o = id3Size(u8); return (u8[o] === 0x66 && u8[o + 1] === 0x4C && u8[o + 2] === 0x61 && u8[o + 3] === 0x43) ? o : -1; }
// header sanity limits: a malformed header must fail fast with a clear message (a 0-channel WAV used to loop forever)
const MAX_CH = 32, MIN_SR = 1000, MAX_SR = 768000;
export function decodeWav(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (p + 8 <= u8.length) {
    const id = str4(dv, p); const sz = dv.getUint32(p + 4, true);
    if (id === 'fmt ') {
      if (sz < 16 || p + 24 > u8.length) throw new Error('Invalid WAV: fmt chunk too short');
      let tag = dv.getUint16(p + 8, true); const ch = dv.getUint16(p + 10, true), sr = dv.getUint32(p + 12, true), bits = dv.getUint16(p + 22, true);
      if (tag === 0xFFFE && sz >= 40 && p + 34 <= u8.length) tag = dv.getUint16(p + 32, true);
      fmt = { tag, ch, sr, bits }; if (dataOff >= 0) break;
    } else if (id === 'data') {
      dataOff = p + 8; dataLen = (sz === 0 || sz === 0xFFFFFFFF || dataOff + sz > u8.length) ? u8.length - dataOff : sz;
      if (fmt || sz === 0 || sz === 0xFFFFFFFF || dataOff + sz > u8.length) break; // otherwise keep scanning: fmt may follow data
    }
    if (sz === 0xFFFFFFFF) break;
    p += 8 + sz + (sz & 1);
  }
  if (!fmt || dataOff < 0) throw new Error('Invalid WAV: missing fmt or data chunk');
  const { tag, ch, sr, bits } = fmt;
  if (![1, 3].includes(tag)) throw new Error('Unsupported WAV encoding (format tag ' + tag + ')');
  if (ch < 1 || ch > MAX_CH) throw new Error('Invalid WAV: ' + ch + ' channels');
  if (sr < MIN_SR || sr > MAX_SR) throw new Error('Invalid WAV: sample rate ' + sr + ' Hz');
  if (tag === 3 ? bits !== 32 && bits !== 64 : ![8, 16, 24, 32].includes(bits)) throw new Error('Unsupported WAV bit depth ' + bits);
  const bps = bits >> 3, frames = Math.floor(dataLen / (bps * ch));
  const out = Array.from({ length: ch }, () => new Float32Array(frames));
  let o = dataOff;
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) {
    let v;
    if (tag === 3) v = bits === 64 ? dv.getFloat64(o, true) : dv.getFloat32(o, true);
    else if (bits === 16) v = dv.getInt16(o, true) / 32768;
    else if (bits === 24) { let x = u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16); if (x & 0x800000) x -= 0x1000000; v = x / 8388608; }
    else if (bits === 32) v = dv.getInt32(o, true) / 2147483648;
    else v = (u8[o] - 128) / 128;
    out[c][i] = v; o += bps;
  }
  return { chans: out, fs: sr, info: { codec: tag === 3 ? 'WAV float' : 'WAV PCM', bitDepth: bits, isFloat: tag === 3, channels: ch } };
}
function readExt80(dv, o) { // IEEE 754 80-bit extended (AIFF sample rate)
  const se = dv.getUint16(o), hi = dv.getUint32(o + 2), lo = dv.getUint32(o + 6), sign = se & 0x8000 ? -1 : 1, e = se & 0x7FFF;
  if (!e && !hi && !lo) return 0; return sign * (hi * Math.pow(2, e - 16383 - 31) + lo * Math.pow(2, e - 16383 - 63));
}
export function decodeAiff(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), isC = str4(dv, 8) === 'AIFC';
  let p = 12, ch = 0, frames = 0, bits = 0, sr = 0, comp = 'NONE', dOff = -1;
  while (p + 8 <= u8.length) {
    const id = str4(dv, p), sz = dv.getUint32(p + 4);
    if (id === 'COMM') { if (p + 26 > u8.length) throw new Error('Invalid AIFF: COMM chunk truncated'); ch = dv.getInt16(p + 8); frames = dv.getUint32(p + 10); bits = dv.getInt16(p + 14); sr = readExt80(dv, p + 16); if (isC && sz >= 22 && p + 30 <= u8.length) comp = str4(dv, p + 26); }
    else if (id === 'SSND') { if (p + 16 > u8.length) throw new Error('Invalid AIFF: SSND chunk truncated'); dOff = p + 16 + dv.getUint32(p + 8); }
    p += 8 + sz + (sz & 1);
  }
  if (!ch || dOff < 0) throw new Error('Invalid AIFF: missing COMM or SSND');
  if (ch < 1 || ch > MAX_CH) throw new Error('Invalid AIFF: ' + ch + ' channels');
  if (!(sr >= MIN_SR && sr <= MAX_SR)) throw new Error('Invalid AIFF: sample rate ' + sr + ' Hz');
  const le = comp === 'sowt', fl = ['fl32', 'FL32', 'fl64', 'FL64'].includes(comp);
  if (!['NONE', 'sowt', 'twos', 'fl32', 'FL32', 'fl64', 'FL64'].includes(comp)) throw new Error('Unsupported AIFF-C compression ' + comp);
  if (comp.toLowerCase() === 'fl64') bits = 64; else if (fl) bits = 32;
  if (!fl && (bits < 1 || bits > 32)) throw new Error('Unsupported AIFF bit depth ' + bits);
  const bps = Math.ceil(bits / 8); frames = Math.min(frames, Math.max(0, Math.floor((u8.length - dOff) / (bps * ch))));
  const out = Array.from({ length: ch }, () => new Float32Array(frames)); let o = dOff;
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) {
    let v;
    if (fl) v = bits === 64 ? dv.getFloat64(o, le) : dv.getFloat32(o, le);
    else if (bps === 2) v = dv.getInt16(o, le) / 32768;
    else if (bps === 3) { let x = le ? (u8[o] | u8[o + 1] << 8 | u8[o + 2] << 16) : (u8[o] << 16 | u8[o + 1] << 8 | u8[o + 2]); if (x & 0x800000) x -= 0x1000000; v = x / 8388608; }
    else if (bps === 4) v = dv.getInt32(o, le) / 2147483648;
    else v = dv.getInt8(o) / 128;
    out[c][i] = v; o += bps;
  }
  return { chans: out, fs: Math.round(sr), info: { codec: isC ? 'AIFF-C' : 'AIFF', bitDepth: bits, isFloat: fl, channels: ch } };
}
export function mp3Info(u8) { // first valid MPEG audio frame header after ID3v2 -> native sample rate
  const SR = [[11025, 12000, 8000], null, [22050, 24000, 16000], [44100, 48000, 32000]];
  for (let p = id3Size(u8); p < Math.min(u8.length - 4, 1 << 20); p++) {
    if (u8[p] !== 0xFF || (u8[p + 1] & 0xE0) !== 0xE0) continue;
    const ver = (u8[p + 1] >> 3) & 3, layer = (u8[p + 1] >> 1) & 3, sri = (u8[p + 2] >> 2) & 3, br = u8[p + 2] >> 4;
    if (ver === 1 || layer === 0 || sri === 3 || br === 15 || br === 0) continue;
    return { sampleRate: SR[ver][sri], channels: ((u8[p + 3] >> 6) === 3) ? 1 : 2 };
  }
  return null;
}
// WAV writer: Int32Array per channel for 16/24-bit PCM, Float32Array for 32-bit float
export function encodeWav(chans, fs, bits, isFloat) {
  const ch = chans.length, n = chans[0].length, bps = bits >> 3, dataLen = n * ch * bps, fmtLen = isFloat ? 18 : 16, factLen = isFloat ? 12 : 0;
  const total = 12 + 8 + fmtLen + factLen + 8 + dataLen + (dataLen & 1), u8 = new Uint8Array(total), dv = new DataView(u8.buffer);
  const w4 = (o, s) => { for (let i = 0; i < 4; i++) u8[o + i] = s.charCodeAt(i); };
  w4(0, 'RIFF'); dv.setUint32(4, total - 8, true); w4(8, 'WAVE'); w4(12, 'fmt '); dv.setUint32(16, fmtLen, true);
  dv.setUint16(20, isFloat ? 3 : 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, fs, true); dv.setUint32(28, fs * ch * bps, true);
  dv.setUint16(32, ch * bps, true); dv.setUint16(34, bits, true); let p = 36;
  if (isFloat) { dv.setUint16(36, 0, true); p = 38; w4(p, 'fact'); dv.setUint32(p + 4, 4, true); dv.setUint32(p + 8, n, true); p += 12; }
  w4(p, 'data'); dv.setUint32(p + 4, dataLen, true); p += 8;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const v = chans[c][i];
    if (isFloat) dv.setFloat32(p, v, true);
    else if (bits === 16) dv.setInt16(p, v, true);
    else { u8[p] = v & 255; u8[p + 1] = (v >> 8) & 255; u8[p + 2] = (v >> 16) & 255; }
    p += bps;
  }
  return u8;
}
