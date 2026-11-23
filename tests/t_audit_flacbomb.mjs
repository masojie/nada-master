// tests/t_audit_flacbomb.mjs - penutup audit 2026-11-19: risiko "bom dekompresi" FLAC (frame CONSTANT kecil, hasil raksasa)
// Batas ada di src/engine/flac.js (MAX_SEC = 3600 detik). Bila konstanta itu diubah, sesuaikan LIMIT_SEC di bawah.
import { suite } from './lib/harness.mjs';
import { decodeFlac } from '../src/engine/flac.js';

const t = suite('audit-flacbomb');
const LIMIT_SEC = 3600, SR = 8000, BS = 65536;
const timed = (fn) => { const t0 = Date.now(); let err = null, res = null; try { res = fn(); } catch (e) { err = e; } return { ms: Date.now() - t0, err, res }; };

// pembangun FLAC mini (mono, 8 bit): STREAMINFO + frame CONSTANT, CRC dihitung manual supaya tidak memakai kode yang diuji
const crc8 = (u, n) => { let c = 0; for (let i = 0; i < n; i++) { c ^= u[i]; for (let k = 0; k < 8; k++) c = (c & 0x80) ? ((c << 1) ^ 0x07) & 0xFF : (c << 1) & 0xFF; } return c; };
const crc16 = (u, n) => { let c = 0; for (let i = 0; i < n; i++) { c ^= u[i] << 8; for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x8005) & 0xFFFF : (c << 1) & 0xFFFF; } return c; };
const utf8num = (n) => {
  if (n < 0x80) return [n];
  const nb = n < 0x800 ? 2 : n < 0x10000 ? 3 : n < 0x200000 ? 4 : n < 0x4000000 ? 5 : n < 0x80000000 ? 6 : 7, o = new Array(nb);
  let v = n; for (let i = nb - 1; i >= 1; i--) { o[i] = 0x80 | (v % 64); v = Math.floor(v / 64); }
  o[0] = ((0xFF << (8 - nb)) & 0xFF) | v; return o;
};
const streaminfo = (sr, total) => {
  const b = new Uint8Array(34); b[0] = b[2] = 0x10; // blok min = maks = 4096
  const v = (BigInt(sr) << 44n) | (7n << 36n) | BigInt(total); // mono, 8 bit
  for (let i = 0; i < 8; i++) b[10 + i] = Number((v >> BigInt(56 - 8 * i)) & 255n);
  return b;
};
const frame = (num, bsc, bs, fixed) => {
  const h = [0xFF, fixed ? 0xF8 : 0xF9, bsc << 4, 1 << 1, ...utf8num(num)];
  if (bsc === 7) h.push((bs - 1) >> 8, (bs - 1) & 255);
  h.push(crc8(h, h.length));
  const f = [...h, 0x00, 0x40]; // subframe CONSTANT, nilai 64
  const c = crc16(f, f.length); return [...f, c >> 8, c & 255];
};
const build = (sr, total, frames) => { const out = [0x66, 0x4C, 0x61, 0x43, 0x80, 0, 0, 34, ...streaminfo(sr, total)]; for (const f of frames) out.push(...f); return Uint8Array.from(out); };
const guard = (r) => !!r.err && /60 minutes/.test(r.err.message);

t.section('kontrol positif: generator menghasilkan FLAC yang valid');
{
  const r = timed(() => decodeFlac(build(SR, 0, [0, 1, 2].map((i) => frame(i, 12, 4096, true))))), d = r.res;
  t.ok('3 frame CONSTANT terdecode utuh tanpa CRC error', !r.err && d.ints[0].length === 3 * 4096 && d.info.crcErrors === 0, r.err ? r.err.message : d.ints[0].length + ' frame, crcErrors=' + d.info.crcErrors);
  t.ok('nilai sampel benar (64)', !r.err && d.ints[0][0] === 64 && d.ints[0][3 * 4096 - 1] === 64, '');
}

t.section('STREAMINFO mengaku lebih dari 60 menit: ditolak sebelum alokasi');
{
  const r = timed(() => decodeFlac(build(SR, SR * LIMIT_SEC + 1, [])));
  t.ok('ditolak dengan pesan batas 60 menit, cepat', guard(r) && r.ms < 200, (r.err && r.err.message) + ' ' + r.ms + ' ms');
}

t.section('satu frame kecil dengan nomor frame raksasa: ditolak, bukan RangeError');
{
  const r = timed(() => decodeFlac(build(SR, 0, [frame(2 ** 31, 12, 4096, true)])));
  t.ok('ditolak dengan pesan batas 60 menit, cepat', guard(r) && r.ms < 200, (r.err && r.err.message) + ' ' + r.ms + ' ms');
}

t.section('banjir frame CONSTANT kecil (variable block size): berhenti di batas 60 menit');
{
  const need = Math.ceil((SR * LIMIT_SEC) / BS) + 2, flood = [];
  for (let i = 0; i < need; i++) flood.push(frame(i * BS, 7, BS, false));
  const u = build(SR, 0, flood), r = timed(() => decodeFlac(u));
  t.ok('berkas kecil (' + u.length + ' byte) ditolak dengan pesan batas 60 menit', u.length < 20000 && guard(r), (r.err && r.err.message) + ' ' + r.ms + ' ms');
  t.ok('selesai < 3 detik', r.ms < 3000, r.ms + ' ms');
  const r2 = timed(() => decodeFlac(build(SR, 0, flood.slice(0, 100))));
  t.ok('di bawah batas tetap terdecode utuh (100 frame)', !r2.err && r2.res.ints[0].length === 100 * BS, r2.err ? r2.err.message : r2.res.ints[0].length + ' frame');
}
t.done();
