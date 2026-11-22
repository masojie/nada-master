// tests/t_audit_misc.mjs - regresi audit 2026-11-19: NM-14 (QC input sunyi), NM-16 (clipping integer), NM-17 (fastTanh), dither saat jenuh
import { suite } from './lib/harness.mjs';
import * as S from './lib/signals.mjs';
import { master } from './lib/pipeline.mjs';
import { exportAudio } from '../src/engine/exporter.js';
import { fastTanh } from '../src/engine/util.js';
import { quantize, resolveDither } from '../src/engine/dither.js';

const t = suite('audit-misc');

t.section('NM-14: QC input sunyi');
{
  const r = master(S.silence(44100, 3), 44100, 'pop-modern', 'modern'), bad = r.qc.filter((q) => q.status === 'fail').map((q) => q.id);
  t.ok('tidak ada FAIL untuk input sunyi', bad.length === 0, bad.join(','));
  t.ok('QC memberi status silent', r.qc.some((q) => q.id === 'silent' && q.status === 'info'));
}

t.section('NM-16: clipping integer dilaporkan saat export');
{
  const n = 4410, x = [new Float32Array(n), new Float32Array(n)]; for (let i = 0; i < n; i++) { x[0][i] = 1.4 * Math.sin(i / 7); x[1][i] = x[0][i]; }
  const e = exportAudio(x, 44100, { format: 'wav', bits: 16, dither: 'tpdf', ceilingDb: -1 }), c = e.checks.find((q) => q.title === 'Integer clipping');
  t.ok('check Integer clipping gagal untuk sinyal +2.9 dBFS', !!c && !c.ok, c ? c.value : 'tidak ada check');
  t.ok('export.ok = false', e.ok === false);
  const g = exportAudio(S.music(44100, 1, { peakDb: -3 }), 44100, { format: 'wav', bits: 24, ceilingDb: -1 }), cg = g.checks.find((q) => q.title === 'Integer clipping');
  t.ok('sinyal normal: check Integer clipping lulus', !!cg && cg.ok, cg ? cg.value : 'tidak ada check');
}

t.section('NM-17: fastTanh');
{
  let me = 0, prev = -2, mono = true; for (let v = -8; v <= 8; v += 1e-4) { const y = fastTanh(v); me = Math.max(me, Math.abs(y - Math.tanh(v))); if (y < prev) mono = false; prev = y; }
  t.atMost('error maksimum <= 2e-6', me, 2e-6);
  t.ok('monoton', mono);
}

t.section('Dither');
t.ok('noise shaping hanya untuk 16-bit', resolveDither('shaped', 24, 44100) === 'tpdf' && resolveDither('shaped', 16, 44100) === 'shaped' && resolveDither('auto', 16, 48000) === 'shaped');
{
  // gelombang kotak 0 dBFS: kode lama menyimpang 7 LSB karena error sampel jenuh ikut diumpankan balik; kini 5 LSB
  const sr = 44100, sq = new Float32Array(sr); for (let i = 0; i < sr; i++) sq[i] = Math.floor(i / 220) % 2 ? 1 : -1;
  const q = quantize([sq], 16, 'shaped', sr); let mx = 0; for (let i = 0; i < sr; i++) mx = Math.max(mx, Math.abs(q.ints[0][i] - Math.max(-32768, Math.min(32767, sq[i] * 32768))));
  t.atMost('overload 0 dBFS: error noise shaping terbatas', mx, 6, ' LSB');
}

t.done();
