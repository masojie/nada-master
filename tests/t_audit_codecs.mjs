// tests/t_audit_codecs.mjs - regresi audit 2026-11-19: NM-04, NM-05 (file rusak tidak boleh hang), NM-11 (STREAMINFO), NM-18 (frame rusak)
import { suite } from './lib/harness.mjs';
import * as S from './lib/signals.mjs';
import { decodeWav, encodeWav } from '../src/engine/codecs.js';
import { encodeFlac, decodeFlac } from '../src/engine/flac.js';

const t = suite('audit-codecs');
const timed = (fn) => { const t0 = Date.now(); let err = null; try { fn(); } catch (e) { err = e; } return { ms: Date.now() - t0, err }; };
const ints = (n, ch = 2, bits = 16) => { const x = S.music(44100, n / 44100 + 0.01, { peakDb: -1 }), sc = Math.pow(2, bits - 1); return Array.from({ length: ch }, (_, c) => Int32Array.from(x[c].subarray(0, n), (v) => Math.max(-sc, Math.min(sc - 1, Math.round(v * sc))))); };

t.section('NM-04: FLAC terpotong atau rusak tidak boleh hang');
{
  const full = encodeFlac(ints(20000), 44100, 16); let worst = 0, slow = 0;
  for (let cut = 0; cut < 160; cut++) { const r = timed(() => decodeFlac(full.slice(0, cut))); worst = Math.max(worst, r.ms); if (r.ms > 500) slow++; }
  t.ok('potongan 0..159 byte selesai < 500 ms', slow === 0, 'terlama=' + worst + ' ms');
  const u = new Uint8Array(110); u.set([0x66, 0x4C, 0x61, 0x43, 0, 0, 0, 34]); u.set([0x10, 0, 0x10, 0, 0, 0, 0, 0, 0, 0, 0x0A, 0xC4, 0x42, 0xF0], 8); u.set([0x06, 0x10, 0, 0], 42);
  const r = timed(() => decodeFlac(u));
  t.ok('blok metadata 1 MiB yang terpotong -> error cepat', !!r.err && r.ms < 500, (r.err && r.err.message) + ' ' + r.ms + ' ms');
}

t.section('NM-05: header WAV tidak valid -> error, bukan hang');
for (const [label, ch, bits] of [['ch=0', 0, 16], ['bits=0', 2, 0], ['bits=4', 2, 4], ['ch=40', 40, 16]]) {
  const w = encodeWav([new Int32Array(8), new Int32Array(8)], 44100, 16, false), dv = new DataView(w.buffer); dv.setUint16(22, ch, true); dv.setUint16(34, bits, true);
  const r = timed(() => decodeWav(w));
  t.ok('WAV ' + label + ' ditolak cepat', !!r.err && r.ms < 500, (r.err && r.err.message) + ' ' + r.ms + ' ms');
}

t.section('NM-11: STREAMINFO valid untuk file pendek');
for (const n of [1, 10, 15, 16, 1000, 4096, 4097]) {
  const a = ints(n), u = encodeFlac(a, 44100, 16), minB = (u[8] << 8) | u[9], maxB = (u[10] << 8) | u[11], d = decodeFlac(u);
  let diff = 0; for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) if (d.ints[c][i] !== a[c][i]) diff++;
  t.ok('N=' + n + ': 16 <= min = max, decode bit-exact', minB >= 16 && minB === maxB && d.ints[0].length === n && diff === 0, 'min=' + minB + ' max=' + maxB + ' beda=' + diff);
}

t.section('NM-18: frame rusak terdeteksi dan diredam');
{
  const a = ints(30000), u = encodeFlac(a, 44100, 16), bad = u.slice(); bad[Math.floor(bad.length * 0.6)] ^= 0x5A;
  const d = decodeFlac(bad); let pk = 0; for (const c of d.chans) for (const v of c) pk = Math.max(pk, Math.abs(v));
  t.ok('crcErrors > 0', d.info.crcErrors > 0, 'crcErrors=' + d.info.crcErrors);
  t.ok('jumlah frame tetap 30000', d.ints[0].length === 30000, d.ints[0].length + ' frame');
  t.atMost('tanpa lonjakan sampah (puncak <= 0 dBFS)', 20 * Math.log10(pk + 1e-12), 0, ' dBFS');
  let same = 0; for (let i = 0; i < 4096; i++) if (d.ints[0][i] === a[0][i]) same++;
  t.ok('frame sebelum kerusakan tetap utuh', same === 4096);
}

t.done();
