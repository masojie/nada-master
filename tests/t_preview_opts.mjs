// tests/t_preview_opts.mjs - previewOpts (gain/ambang dari laporan render atau taksiran) dan AudioWorklet preview (diuji dengan lingkungan worklet palsu di Node).
import { suite } from './lib/harness.mjs';
import { BASE_FULL } from '../src/engine/settings.js';
import { cloneDeep } from '../src/engine/util.js';
import { previewOpts } from '../src/preview/preview-opts.js';
import { buildParams } from '../src/preview/preview-params.js';
import { PreviewCore } from '../src/preview/preview-core.js';

const t = suite('preview-opts');
t.section('previewOpts');
const S = cloneDeep(BASE_FULL), an = { loudness: { integrated: -20 } };
let o = previewOpts({ settings: S, an, report: null, rendered: null });
t.ok('tanpa render: gain headroom = refLufs - loudness lagu', Math.abs(o.autoGainDb - (S.pre.refLufs + 20)) < 1e-9, 'auto=' + o.autoGainDb);
t.ok('tanpa render: ambang dan gain output ditandai taksiran', o.estimated.includes('comp threshold') && o.estimated.includes('output gain'), o.estimated.join(','));
t.ok('tanpa render: gain output tidak negatif dan <= 15', o.outGainDb >= 0 && o.outGainDb <= 15, 'out=' + o.outGainDb);
const rendered = cloneDeep(S), report = { stages: { comp: { thrDb: -22 } }, loudness: { gainDb: 7.5 } };
o = previewOpts({ settings: S, an, report, rendered });
t.ok('setelah render: gain output = gainDb laporan', o.outGainDb === 7.5);
t.ok('setelah render: ambang = persentil dari laporan + offset sekarang, tanpa taksiran', Math.abs(o.thrDb - (-22 - rendered.comp.thrOffsetDb + S.comp.thrOffsetDb)) < 1e-9 && o.estimated.length === 0, 'thr=' + o.thrDb);
const S2 = cloneDeep(S); S2.comp.thrOffsetDb = S.comp.thrOffsetDb - 2; o = previewOpts({ settings: S2, an, report, rendered });
t.ok('offset kompresor diubah: ambang ikut bergeser 2 dB', Math.abs(o.thrDb - (-22 - rendered.comp.thrOffsetDb + S2.comp.thrOffsetDb)) < 1e-9);
const S3 = cloneDeep(S); S3.pre.bypass = true; o = previewOpts({ settings: S3, an: { loudness: { integrated: NaN } }, report: null, rendered: null });
t.ok('loudness tidak diketahui: tidak ada NaN di keluaran', !Object.values(o).some((v) => typeof v === 'number' && !isFinite(v)));
const bp = buildParams(S, 48000, previewOpts({ settings: S, an, report, rendered }));
t.ok('buildParams menerima keluaran previewOpts', bp && bp.params && isFinite(bp.params.outGainDb) && isFinite(bp.params.comp.thrDb));

t.section('AudioWorklet preview (lingkungan worklet palsu)');
let Proc = null; const msgs = [];
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => msgs.push(m), onmessage: null }; } };
globalThis.registerProcessor = (name, cls) => { if (name === 'lintang-preview') Proc = cls; };
globalThis.sampleRate = 48000; globalThis.currentFrame = 0;
await import('../src/preview/preview-worklet.js');
t.ok('worklet mendaftarkan processor lintang-preview', typeof Proc === 'function');
const p = new Proc(), ref = new PreviewCore(48000, bp.params);
p.port.onmessage({ data: { params: bp.params, settle: true } });
let maxd = 0, fin = true; const rin = new Float64Array(128), z = new Float64Array(128), rL = new Float64Array(128), rR = new Float64Array(128);
for (let b = 0; b < 600; b++) {
  const a = new Float32Array(128), c = new Float32Array(128); for (let i = 0; i < 128; i++) { a[i] = 0.4 * Math.sin((b * 128 + i) * 0.05); c[i] = 0.3 * Math.sin((b * 128 + i) * 0.031); }
  const oL = new Float32Array(128), oR = new Float32Array(128); globalThis.currentFrame = b * 128;
  p.process([[a, c]], [[oL, oR]]);
  for (let i = 0; i < 128; i++) { rin[i] = a[i]; z[i] = c[i]; } ref.process(rin, z, rL, rR, 128);
  for (let i = 0; i < 128; i++) { if (!isFinite(oL[i]) || !isFinite(oR[i])) fin = false; maxd = Math.max(maxd, Math.abs(oL[i] - rL[i]), Math.abs(oR[i] - rR[i])); }
}
t.ok('keluaran worklet berhingga selama 600 blok', fin);
t.ok('keluaran worklet sama dengan PreviewCore langsung (selisih hanya pembulatan float32)', maxd < 1e-6, 'selisih maks=' + maxd.toExponential(2));
t.ok('worklet mengirim meter berisi cpu, glitch, m', msgs.length >= 8 && msgs.every((m) => isFinite(m.cpu) && m.glitch === 0 && m.m.length === 8), 'pesan=' + msgs.length);
const before = msgs.length; globalThis.currentFrame = 600 * 128 + 128 * 5; const a0 = new Float32Array(128), o0 = new Float32Array(128), o1 = new Float32Array(128);
p.process([[a0, a0]], [[o0, o1]]); for (let b = 1; b < 64; b++) { globalThis.currentFrame = 600 * 128 + 128 * (5 + b); p.process([[a0, a0]], [[o0, o1]]); }
t.ok('blok terlewat (lompatan currentFrame) tercatat sebagai gangguan', msgs.length > before && msgs[msgs.length - 1].glitch >= 5, 'glitch=' + (msgs[msgs.length - 1] || {}).glitch);
const o2 = [new Float32Array(128).fill(9), new Float32Array(128).fill(9)]; p.process([[]], [o2]);
t.ok('tanpa input terhubung: keluaran senyap (nol), bukan sampah', o2[0].every((v) => v === 0) && o2[1].every((v) => v === 0));
const pm = new Proc(); pm.port.onmessage({ data: { params: bp.params, settle: true } });
const mono = Float32Array.from({ length: 128 }, (_, i) => 0.3 * Math.sin(i * 0.1)), m0 = new Float32Array(128), m1 = new Float32Array(128); for (let b = 0; b < 10; b++) pm.process([[mono]], [[m0, m1]]);
t.ok('input mono diumpankan ke dua kanal (kiri = kanan)', m0.every((v, i) => v === m1[i]));
t.done();
