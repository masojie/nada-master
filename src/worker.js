// worker.js - DSP engine thread: decode, analyse, plan presets, render 12-stage chain, QC, export. Offline, deterministic, no AI.
import { detectFormat, decodeWav, decodeAiff } from './engine/codecs.js';
import { decodeFlac } from './engine/flac.js';
import { analyzeAudio } from './engine/analysis.js';
import { resolveSettings, getGenre } from './engine/settings.js';
import { planAdaptive } from './engine/adaptive.js';
import { renderMaster } from './engine/chain.js';
import { runQC } from './engine/qc.js';
import { exportAudio } from './engine/exporter.js';
let src = null, an = null, out = null;
const post = (m, tr) => self.postMessage(m, tr || []);
const copies = (chans) => chans.map((c) => c.slice());
function plan(opts) { const base = resolveSettings(opts); return planAdaptive(base, an, getGenre(base.meta.genre)); }
function load(chans, fs, info) {
  let note = null; if (chans.length > 2) { chans = chans.slice(0, 2); note = 'Multichannel file: first two channels used.'; }
  src = { chans, fs }; out = null; post({ type: 'progress', id: 'analysis', label: 'Analysing source' });
  const t = Date.now(); an = analyzeAudio(chans, fs); const pcm = copies(chans);
  post({ type: 'loaded', info: Object.assign({}, info, { fs, channels: chans.length, frames: chans[0].length, duration: chans[0].length / fs, note, ms: Date.now() - t }), analysis: an, pcm }, pcm.map((c) => c.buffer));
}
self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'decode') {
      const u8 = new Uint8Array(m.buffer), k = detectFormat(u8);
      const d = k === 'wav' ? decodeWav(u8) : k === 'aiff' ? decodeAiff(u8) : k === 'flac' ? decodeFlac(u8) : null;
      if (!d) throw new Error('Unsupported file format');
      load(d.chans, d.fs, Object.assign({ name: m.name, size: u8.length }, d.info));
    } else if (m.type === 'pcm') load(m.chans, m.fs, m.info);
    else if (m.type === 'plan') { if (!an) return; const p = plan(m.opts); post({ type: 'plan', settings: p.settings, actions: p.actions, problems: p.problems }); }
    else if (m.type === 'master') {
      if (!src) throw new Error('No audio loaded');
      const p = plan(m.opts), S = m.settings || p.settings, t = Date.now();
      out = renderMaster(src, S, an, (s) => post({ type: 'progress', id: s.id, label: s.label }));
      const qc = runQC(out.analysis, an, out.report, S), pcm = copies(out.chans);
      post({ type: 'mastered', analysis: out.analysis, report: out.report, qc, settings: S, actions: p.actions, problems: p.problems, edited: !!m.settings, ms: Date.now() - t, pcm }, pcm.map((c) => c.buffer));
    } else if (m.type === 'export') {
      if (!out) throw new Error('Nothing mastered yet');
      const r = exportAudio(out.chans, out.fs, m.opts);
      post({ type: 'exported', bytes: r.bytes, fs: r.fs, dither: r.dither, checks: r.checks, ok: r.ok, ms: r.ms, opts: m.opts }, [r.bytes.buffer]);
    }
  } catch (err) { post({ type: 'error', message: (err && err.message) || String(err) }); }
};
