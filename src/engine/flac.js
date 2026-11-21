// flac.js — native FLAC decoder (CONSTANT/VERBATIM/FIXED/LPC, all stereo modes) and encoder
// (FIXED predictors + partitioned Rice, best-of-4 stereo decorrelation, STREAMINFO MD5)
import { id3Size } from './codecs.js';
const CRC8T = new Uint8Array(256), CRC16T = new Uint16Array(256);
for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xFF : (c << 1) & 0xFF; CRC8T[i] = c;
  let d = i << 8; for (let k = 0; k < 8; k++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xFFFF : (d << 1) & 0xFFFF; CRC16T[i] = d; }
function crc8(u8, a, b) { let c = 0; for (let i = a; i < b; i++) c = CRC8T[c ^ u8[i]]; return c; }
function crc16(u8, a, b) { let c = 0; for (let i = a; i < b; i++) c = ((c << 8) & 0xFFFF) ^ CRC16T[(c >> 8) ^ u8[i]]; return c; }
// ---------- MD5 (RFC 1321) ----------
const MD5K = new Int32Array(64), MD5S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
for (let i = 0; i < 64; i++) MD5K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
export class MD5 {
  constructor() { this.h = new Int32Array([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476]); this.buf = new Uint8Array(64); this.bl = 0; this.len = 0; this.w = new Int32Array(16); }
  _block(b, o) {
    const w = this.w; for (let i = 0; i < 16; i++) w[i] = b[o + 4 * i] | b[o + 4 * i + 1] << 8 | b[o + 4 * i + 2] << 16 | b[o + 4 * i + 3] << 24;
    let a = this.h[0], bb = this.h[1], c = this.h[2], d = this.h[3];
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (bb & c) | (~bb & d); g = i; } else if (i < 32) { f = (d & bb) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = bb ^ c ^ d; g = (3 * i + 5) & 15; } else { f = c ^ (bb | ~d); g = (7 * i) & 15; }
      const t = d; d = c; c = bb; const s = MD5S[(i >> 4) * 4 + (i & 3)], x = (a + f + MD5K[i] + w[g]) | 0;
      bb = (bb + ((x << s) | (x >>> (32 - s)))) | 0; a = t;
    }
    this.h[0] = (this.h[0] + a) | 0; this.h[1] = (this.h[1] + bb) | 0; this.h[2] = (this.h[2] + c) | 0; this.h[3] = (this.h[3] + d) | 0;
  }
  update(u8, n = u8.length) {
    this.len += n; let i = 0;
    if (this.bl) { while (i < n && this.bl < 64) this.buf[this.bl++] = u8[i++]; if (this.bl === 64) { this._block(this.buf, 0); this.bl = 0; } }
    for (; i + 64 <= n; i += 64) this._block(u8, i);
    while (i < n) this.buf[this.bl++] = u8[i++];
  }
  digest() {
    const bits = this.len * 8, pad = new Uint8Array(((this.bl < 56) ? 56 : 120) - this.bl + 8); pad[0] = 0x80;
    const lo = bits >>> 0, hi = Math.floor(bits / 4294967296), L = pad.length;
    for (let i = 0; i < 4; i++) { pad[L - 8 + i] = (lo >>> (8 * i)) & 255; pad[L - 4 + i] = (hi >>> (8 * i)) & 255; }
    const keep = this.len; this.update(pad); this.len = keep;
    const out = new Uint8Array(16); for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) out[4 * i + k] = (this.h[i] >>> (8 * k)) & 255; return out;
  }
}
function md5Frames(md5, ints, start, n, bits, scratch) {
  const ch = ints.length, bps = Math.ceil(bits / 8); let p = 0;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { let v = ints[c][start + i]; for (let k = 0; k < bps; k++) { scratch[p++] = v & 255; v >>= 8; } }
  md5.update(scratch, p);
}
export function md5OfInts(ints, bits) { const m = new MD5(), N = ints[0].length, sc = new Uint8Array(4096 * ints.length * 4); for (let s = 0; s < N; s += 4096) md5Frames(m, ints, s, Math.min(4096, N - s), bits, sc); return m.digest(); }
// ---------- bit I/O ----------
class BitReader {
  constructor(u8, pos) { this.b = u8; this.p = pos; this.k = 0; }
  read(n) { let v = 0; while (n > 0) { const av = 8 - this.k, t = av < n ? av : n, bits = (this.b[this.p] >>> (av - t)) & ((1 << t) - 1); v = v * (1 << t) + bits; this.k += t; n -= t; if (this.k === 8) { this.k = 0; this.p++; } } return v; }
  sread(n) { const v = this.read(n), h = Math.pow(2, n - 1); return v >= h ? v - 2 * h : v; }
  unary() { let q = 0; for (;;) { if (this.p >= this.b.length) throw new Error('FLAC: unexpected end of stream'); const byte = (this.b[this.p] << this.k) & 0xFF; if (!byte) { q += 8 - this.k; this.k = 0; this.p++; continue; } const lz = Math.clz32(byte) - 24; q += lz; this.k += lz + 1; if (this.k >= 8) { this.k -= 8; this.p++; } return q; } }
  align() { if (this.k) { this.k = 0; this.p++; } }
}
// MSB-first bit writer with an integer accumulator (fewer than 8 pending bits + at most 24 new bits always fit in 31 bits)
class BitWriter {
  constructor(cap) { this.u = new Uint8Array(cap); this.p = 0; this.cur = 0; this.n = 0; }
  _grow() { const u = new Uint8Array(this.u.length * 2); u.set(this.u); this.u = u; }
  write(v, n) { // v: unsigned integer < 2^n, n <= 32
    if (n > 24) { const hi = Math.floor(v / 16777216); this.write(hi, n - 24); v -= hi * 16777216; n = 24; }
    this.cur = (this.cur << n) | v; this.n += n;
    while (this.n >= 8) { this.n -= 8; if (this.p >= this.u.length) this._grow(); this.u[this.p++] = (this.cur >>> this.n) & 255; }
    this.cur &= (1 << this.n) - 1;
  }
  swrite(v, n) { this.write(v < 0 ? v + Math.pow(2, n) : v, n); }
  rice(u, k) { let q = Math.floor(u / (1 << k)); while (q >= 24) { this.write(0, 24); q -= 24; } this.write(1, q + 1); if (k) this.write(u & ((1 << k) - 1), k); }
  align() { if (this.n) this.write(0, 8 - this.n); }
}
// ---------- decoder ----------
const MAX_SEC = 3600; // streams longer than 60 minutes are refused (also guards against decompression bombs made of CONSTANT frames)
export function decodeFlac(u8) {
  let p = id3Size(u8);
  if (p + 4 > u8.length || String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]) !== 'fLaC') throw new Error('Not a FLAC stream');
  p += 4; let si = null, last = false;
  while (!last) {
    if (p + 4 > u8.length) throw new Error('FLAC: truncated metadata');
    const hdr = u8[p]; last = !!(hdr & 0x80); const type = hdr & 0x7F, len = (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]; p += 4;
    if (p + len > u8.length) throw new Error('FLAC: truncated metadata block');
    if (type === 0) { if (len < 34) throw new Error('FLAC: invalid STREAMINFO'); const r = new BitReader(u8, p), blk = r.read(16); r.read(16); r.read(24); r.read(24);
      si = { blk, sr: r.read(20), ch: r.read(3) + 1, bits: r.read(5) + 1, total: r.read(36) }; si.md5 = u8.slice(p + 18, p + 34); }
    p += len;
  }
  if (!si) throw new Error('FLAC: missing STREAMINFO');
  if (!si.sr || si.bits < 4) throw new Error('FLAC: invalid STREAMINFO');
  const maxFrames = si.sr * MAX_SEC; if (si.total > maxFrames) throw new Error('FLAC: streams longer than 60 minutes are not supported');
  let cap = si.total || 1 << 20; let out = Array.from({ length: si.ch }, () => new Int32Array(cap)); let pos = 0, crcErr = 0, expect = p;
  const BS = [0, 192, 576, 1152, 2304, 4608, 0, 0, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768], SS = [0, 8, 12, 0, 16, 20, 24, 32];
  while (p + 2 < u8.length) {
    if (u8[p] !== 0xFF || (u8[p + 1] & 0xFE) !== 0xF8) { p++; continue; }
    const fstart = p, fixed = (u8[p + 1] & 1) === 0, r = new BitReader(u8, p); r.read(16);
    const bsc = r.read(4), src = r.read(4), chA = r.read(4), ssc = r.read(3); r.read(1);
    let c0 = r.read(8), extra = 0; while (c0 & 0x80) { c0 = (c0 << 1) & 0xFF; extra++; } let num = c0 >> extra; for (let i = 1; i < extra; i++) num = num * 64 + (r.read(8) & 0x3F);
    let bs = BS[bsc]; if (bsc === 6) bs = r.read(8) + 1; else if (bsc === 7) bs = r.read(16) + 1;
    if (src === 12) r.read(8); else if (src === 13 || src === 14) r.read(16);
    const hpos = r.p, hcrc = r.read(8), bits = SS[ssc] || si.bits, nch = chA < 8 ? chA + 1 : 2;
    // a frame header is accepted only with a valid CRC-8: this rejects false sync codes inside audio data
    if (!bs || nch !== si.ch || chA > 10 || extra === 1 || extra > 7 || hpos >= u8.length || crc8(u8, fstart, hpos) !== hcrc) { if (fstart === expect) crcErr++; p++; continue; }
    const at = fixed ? num * (si.blk || bs) : num; // position from the frame number: a lost or damaged frame leaves silence, never a timing shift
    if (at + bs > maxFrames) throw new Error('FLAC: streams longer than 60 minutes are not supported');
    if (at + bs > cap) { cap = Math.max(cap * 2, at + bs); out = out.map((a) => { const b = new Int32Array(cap); b.set(a); return b; }); }
    let sub = null;
    try { sub = []; for (let c = 0; c < nch; c++) { const side = (chA === 8 && c === 1) || (chA === 9 && c === 0) || (chA === 10 && c === 1); sub.push(decodeSubframe(r, bs, bits + (side ? 1 : 0))); } r.align(); } catch (e) { sub = null; }
    if (!sub || r.p + 2 > u8.length || crc16(u8, fstart, r.p) !== r.read(16)) { crcErr++; pos = Math.max(pos, at + bs); p = fstart + 2; continue; } // damaged frame: muted
    for (let i = 0; i < bs; i++) {
      const a = sub[0][i], b = nch > 1 ? sub[1][i] : 0; let L = a, R = b;
      if (chA === 8) { R = a - b; } else if (chA === 9) { L = a + b; R = b; } else if (chA === 10) { const m = a * 2 + (b & 1); L = (m + b) >> 1; R = (m - b) >> 1; }
      out[0][at + i] = L; if (nch > 1) out[1][at + i] = R; for (let c = 2; c < nch; c++) out[c][at + i] = sub[c][i];
    }
    pos = Math.max(pos, at + bs); p = r.p; expect = p;
  }
  const scale = 1 / Math.pow(2, si.bits - 1), n = si.total ? Math.min(pos, si.total) : pos;
  const chans = out.map((a) => { const f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = a[i] * scale; return f; });
  return { chans, fs: si.sr, ints: out.map((a) => a.subarray(0, n)), info: { codec: 'FLAC', bitDepth: si.bits, isFloat: false, channels: si.ch, crcErrors: crcErr, md5: si.md5 } };
}
function decodeSubframe(r, n, bps) {
  r.read(1); const t = r.read(6); let wasted = 0; if (r.read(1)) wasted = r.unary() + 1;
  const b = bps - wasted, s = new Int32Array(n);
  if (t === 0) { const v = r.sread(b); s.fill(v); }
  else if (t === 1) { for (let i = 0; i < n; i++) s[i] = r.sread(b); }
  else if (t >= 8 && t <= 12) { const ord = t - 8; for (let i = 0; i < ord; i++) s[i] = r.sread(b); flacResidual(r, s, n, ord);
    for (let i = ord; i < n; i++) { const e = s[i]; s[i] = ord === 0 ? e : ord === 1 ? e + s[i - 1] : ord === 2 ? e + 2 * s[i - 1] - s[i - 2] : ord === 3 ? e + 3 * s[i - 1] - 3 * s[i - 2] + s[i - 3] : e + 4 * s[i - 1] - 6 * s[i - 2] + 4 * s[i - 3] - s[i - 4]; } }
  else if (t >= 32) { const ord = t - 31; for (let i = 0; i < ord; i++) s[i] = r.sread(b);
    const prec = r.read(4) + 1, shift = r.sread(5), co = new Float64Array(ord); for (let i = 0; i < ord; i++) co[i] = r.sread(prec);
    flacResidual(r, s, n, ord); const sc = Math.pow(2, -shift);
    for (let i = ord; i < n; i++) { let acc = 0; for (let j = 0; j < ord; j++) acc += co[j] * s[i - j - 1]; s[i] += Math.floor(acc * sc); } }
  else throw new Error('FLAC: reserved subframe type ' + t);
  if (wasted) for (let i = 0; i < n; i++) s[i] *= (1 << wasted);
  return s;
}
function flacResidual(r, s, n, ord) {
  const method = r.read(2), pb = method === 0 ? 4 : 5, esc = method === 0 ? 15 : 31, po = r.read(4), parts = 1 << po; let i = ord;
  for (let pt = 0; pt < parts; pt++) {
    const cnt = (n >> po) - (pt === 0 ? ord : 0), k = r.read(pb);
    if (k === esc) { const nb = r.read(5); for (let j = 0; j < cnt; j++) s[i++] = nb ? r.sread(nb) : 0; }
    else for (let j = 0; j < cnt; j++) { const q = r.unary(), u = k ? q * (1 << k) + r.read(k) : q; s[i++] = (u % 2) ? -(u + 1) / 2 : u / 2; }
  }
}
// ---------- encoder ----------
function fixedResidual(x, n, ord, out) {
  for (let i = 0; i < ord; i++) out[i] = 0;
  for (let i = ord; i < n; i++) out[i] = ord === 0 ? x[i] : ord === 1 ? x[i] - x[i - 1] : ord === 2 ? x[i] - 2 * x[i - 1] + x[i - 2] : ord === 3 ? x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3] : x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4];
}
function riceK(sum, cnt) { if (cnt <= 0) return 0; let k = 0; const m = sum / cnt; while (k < 30 && (1 << (k + 1)) <= m + 1) k++; return k; }
// partition sums are computed once at the finest valid order and merged pairwise for coarser orders (same choice as an exhaustive scan)
function planRice(res, n, ord, maxPo) {
  let mp = -1; for (let po = 0; po <= maxPo; po++) { if ((n >> po) <= ord || (n % (1 << po))) break; mp = po; }
  if (mp < 0) return null;
  const levels = new Array(mp + 1), fine = new Float64Array(1 << mp), flen = n >> mp;
  for (let pt = 0; pt < (1 << mp); pt++) { const a = pt === 0 ? ord : pt * flen, b = (pt + 1) * flen; let s = 0; for (let i = a; i < b; i++) { const v = res[i]; s += v >= 0 ? 2 * v : -2 * v - 1; } fine[pt] = s; }
  levels[mp] = fine; for (let po = mp - 1; po >= 0; po--) { const up = levels[po + 1], cur = new Float64Array(1 << po); for (let j = 0; j < cur.length; j++) cur[j] = up[2 * j] + up[2 * j + 1]; levels[po] = cur; }
  let best = null;
  for (let po = 0; po <= mp; po++) {
    const parts = 1 << po, ks = [], len = n >> po, sums = levels[po]; let bits = 6;
    for (let pt = 0; pt < parts; pt++) {
      const cnt = len - (pt === 0 ? ord : 0), sum = sums[pt], k0 = riceK(sum, cnt); let bk = k0, bb = Infinity;
      for (let k = Math.max(0, k0 - 1); k <= Math.min(30, k0 + 1); k++) { const est = cnt * (k + 1) + Math.floor(sum / Math.pow(2, k)); if (est < bb) { bb = est; bk = k; } }
      ks.push(bk); bits += bb + 5;
    }
    if (!best || bits < best.bits) best = { po, ks, bits };
  }
  return best;
}
function chooseSubframe(x, n, bps, tmp) {
  let allEq = true; for (let i = 1; i < n; i++) if (x[i] !== x[0]) { allEq = false; break; }
  if (allEq) return { type: 'const', bits: 8 + bps };
  let best = { type: 'verbatim', bits: 8 + n * bps };
  for (let ord = 0; ord <= 4 && ord < n; ord++) {
    fixedResidual(x, n, ord, tmp); const pl = planRice(tmp, n, ord, 8); if (!pl) continue;
    const bits = 8 + ord * bps + pl.bits; if (bits < best.bits) best = { type: 'fixed', ord, plan: pl, bits };
  }
  return best;
}
function writeSubframe(bw, x, n, bps, c, tmp) {
  bw.write(0, 1);
  if (c.type === 'const') { bw.write(0, 6); bw.write(0, 1); bw.swrite(x[0], bps); return; }
  if (c.type === 'verbatim') { bw.write(1, 6); bw.write(0, 1); for (let i = 0; i < n; i++) bw.swrite(x[i], bps); return; }
  bw.write(8 + c.ord, 6); bw.write(0, 1);
  for (let i = 0; i < c.ord; i++) bw.swrite(x[i], bps);
  fixedResidual(x, n, c.ord, tmp); const po = c.plan.po, ks = c.plan.ks, big = ks.some((k) => k > 14);
  bw.write(big ? 1 : 0, 2); bw.write(po, 4); const len = n >> po;
  for (let pt = 0; pt < (1 << po); pt++) {
    const k = ks[pt]; bw.write(k, big ? 5 : 4);
    for (let i = pt === 0 ? c.ord : pt * len; i < (pt + 1) * len; i++) { const v = tmp[i]; bw.rice(v >= 0 ? 2 * v : -2 * v - 1, k); }
  }
}
function utf8num(bw, v) {
  if (v < 0x80) { bw.write(v, 8); return; }
  const nb = v < 0x800 ? 2 : v < 0x10000 ? 3 : v < 0x200000 ? 4 : v < 0x4000000 ? 5 : 6;
  bw.write(((0xFF00 >> nb) & 0xFF) | Math.floor(v / Math.pow(2, 6 * (nb - 1))), 8);
  for (let i = nb - 2; i >= 0; i--) bw.write(0x80 | (Math.floor(v / Math.pow(2, 6 * i)) & 0x3F), 8);
}
export function encodeFlac(ints, fs, bits, blockSize = 4096) {
  const nch = ints.length, N = ints[0].length, bw = new BitWriter(Math.max(1 << 16, N * nch * (bits >> 3) + 1024)), md5 = new MD5();
  const SRC = { 88200: 1, 176400: 2, 192000: 3, 8000: 4, 16000: 5, 22050: 6, 24000: 7, 32000: 8, 44100: 9, 48000: 10, 96000: 11 }, SSC = { 8: 1, 12: 2, 16: 4, 20: 5, 24: 6 };
  bw.write(0x664C6143, 32); bw.write(0x80, 8); bw.write(34, 24); const siPos = bw.p; for (let i = 0; i < 34; i++) bw.write(0, 8);
  const tmp = new Int32Array(blockSize), side = new Int32Array(blockSize), mid = new Int32Array(blockSize), scratch = new Uint8Array(blockSize * nch * 4);
  let minF = 1 << 30, maxF = 0, frame = 0;
  for (let start = 0; start < N; start += blockSize, frame++) {
    const n = Math.min(blockSize, N - start), fst = bw.p, chs = ints.map((a) => a.subarray(start, start + n));
    md5Frames(md5, ints, start, n, bits, scratch);
    let assign = nch - 1, cands;
    if (nch === 2) {
      for (let i = 0; i < n; i++) { side[i] = chs[0][i] - chs[1][i]; mid[i] = (chs[0][i] + chs[1][i]) >> 1; }
      const sd = side.subarray(0, n), md = mid.subarray(0, n);
      const cL = chooseSubframe(chs[0], n, bits, tmp), cR = chooseSubframe(chs[1], n, bits, tmp), cS = chooseSubframe(sd, n, bits + 1, tmp), cM = chooseSubframe(md, n, bits, tmp);
      const opts = [[1, cL.bits + cR.bits, [[chs[0], cL, bits], [chs[1], cR, bits]]], [8, cL.bits + cS.bits, [[chs[0], cL, bits], [sd, cS, bits + 1]]],
        [9, cS.bits + cR.bits, [[sd, cS, bits + 1], [chs[1], cR, bits]]], [10, cM.bits + cS.bits, [[md, cM, bits], [sd, cS, bits + 1]]]];
      opts.sort((a, b) => a[1] - b[1]); assign = opts[0][0]; cands = opts[0][2];
    } else cands = chs.map((x) => [x, chooseSubframe(x, n, bits, tmp), bits]);
    bw.write(0x3FFE, 14); bw.write(0, 1); bw.write(0, 1);
    const bsc = n === 4096 ? 12 : 7; bw.write(bsc, 4); bw.write(SRC[fs] || 0, 4); bw.write(assign, 4); bw.write(SSC[bits] || 0, 3); bw.write(0, 1);
    utf8num(bw, frame); if (bsc === 7) bw.write(n - 1, 16);
    bw.write(crc8(bw.u, fst, bw.p), 8);
    for (const [x, c, b] of cands) writeSubframe(bw, x, n, b, c, tmp);
    bw.align(); const crc = crc16(bw.u, fst, bw.p); bw.write(crc, 16);
    const fl = bw.p - fst; if (fl < minF) minF = fl; if (fl > maxF) maxF = fl;
  }
  if (!frame) minF = 0;
  // block size fields: min = max = the block size actually used (never below the spec minimum of 16; the last block may be shorter)
  const out = bw.u.slice(0, bw.p), si = new BitWriter(64), mbs = Math.max(16, Math.min(blockSize, N));
  si.write(mbs, 16); si.write(mbs, 16); si.write(minF, 24); si.write(maxF, 24); si.write(fs, 20); si.write(nch - 1, 3); si.write(bits - 1, 5);
  si.write(Math.floor(N / 4294967296), 4); si.write(N >>> 0, 32); const dg = md5.digest(); for (let i = 0; i < 16; i++) si.write(dg[i], 8);
  out.set(si.u.subarray(0, 34), siPos);
  return out;
}
