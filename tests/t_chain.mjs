import fs from 'fs';
import { decodeWav } from '../src/engine/codecs.js';
import { analyzeAudio } from '../src/engine/analysis.js';
import { resolveSettings, getGenre } from '../src/engine/settings.js';
import { planAdaptive } from '../src/engine/adaptive.js';
import { renderMaster } from '../src/engine/chain.js';
import { runQC } from '../src/engine/qc.js';
import { exportAudio } from '../src/engine/exporter.js';
import { createHash } from 'crypto';
const cases = (process.argv[2] || 'Funkorama.wav:pop-modern:modern,Metalmania.wav:metal:loud,Funkorama.wav:jazz:dynamic,Funkorama.wav:dangdut-koplo:warm,Funkorama.wav:classical:transparent,f48_24.wav:edm:modern,mono_quiet.wav:acoustic:modern').split(',');
for (const c of cases) {
  const [file, genre, mode] = c.split(':'); const src = decodeWav(new Uint8Array(fs.readFileSync('testdata/' + file)));
  let t = Date.now(); const an = analyzeAudio(src.chans, src.fs); const tA = Date.now() - t;
  const base = resolveSettings({ genre, mode }); const { settings, actions, problems } = planAdaptive(base, an, getGenre(genre));
  t = Date.now(); const out = renderMaster(src, settings, an); const tR = Date.now() - t;
  const qc = runQC(out.analysis, an, out.report, settings); const fails = qc.filter((q) => q.status !== 'pass').map((q) => q.id + ':' + q.status + '(' + q.value + ')');
  const ex = exportAudio(out.chans, out.fs, { format: 'wav', bits: 16, dither: 'auto', ceilingDb: settings.lim.ceilingDb });
  const exf = exportAudio(out.chans, out.fs, { format: 'flac', bits: 24, sampleRate: out.fs === 44100 ? 48000 : 44100, ceilingDb: settings.lim.ceilingDb });
  const h = createHash('md5').update(Buffer.from(out.chans[0].buffer)).digest('hex').slice(0, 8);
  const L = out.report.loudness, m = out.analysis;
  console.log(`${file} ${genre}/${mode} ${src.fs}Hz ${src.chans.length}ch | in ${an.loudness.integrated.toFixed(1)} LUFS TP ${an.truePeak.dbtp.toFixed(2)} LRA ${an.loudness.lra.toFixed(1)} | target ${settings.loud.targetLufs} -> ${m.loudness.integrated.toFixed(2)} LUFS TP ${m.truePeak.dbtp.toFixed(2)} LRA ${m.loudness.lra.toFixed(1)} PLR ${m.plr.toFixed(1)} | lim ${L.limitingLu} LU it${L.iterations} capped=${L.capped} | adapt ${actions.length} probs ${problems.map((p) => p.id).join('/')} | QC!=${fails.join(' ') || 'all pass'} | wav16 ${ex.ok ? 'OK' : 'FAIL'} ${ex.dither} flac24@${exf.fs} ${exf.ok ? 'OK' : 'FAIL ' + JSON.stringify(exf.checks)} | ${tA}ms/${tR}ms ${JSON.stringify(out.report.timings)} md5 ${h}`);
  if (process.argv[3] === 'save') fs.writeFileSync('/tmp/' + genre + '_' + mode + '.wav', ex.bytes);
}
