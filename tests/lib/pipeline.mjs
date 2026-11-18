// tests/lib/pipeline.mjs - jalur master lengkap persis seperti yang dijalankan worker:
// analisis sumber -> resolve setting -> rencana adaptif -> render 12 tahap -> QC.
import * as S from './signals.mjs';
import { analyzeAudio } from '../../src/engine/analysis.js';
import { resolveSettings, getGenre } from '../../src/engine/settings.js';
import { planAdaptive } from '../../src/engine/adaptive.js';
import { renderMaster } from '../../src/engine/chain.js';
import { runQC } from '../../src/engine/qc.js';

export function master(chans, fs, genre = 'pop-modern', mode = 'modern', extra = {}) {
  const an = analyzeAudio(chans, fs);
  const base = resolveSettings({ genre, mode, ...extra });
  const { settings, actions, problems } = planAdaptive(base, an, getGenre(genre));
  const out = renderMaster(S.source(chans, fs), settings, an);
  const qc = runQC(out.analysis, an, out.report, settings);
  return { an, settings, actions, problems, out, qc };
}
export const qcStatus = (qc, id) => (qc.find((q) => q.id === id) || {}).status;
