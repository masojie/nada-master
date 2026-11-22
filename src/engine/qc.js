// qc.js — automatic quality control of the rendered master
export function runQC(m, o, rep, S) {
  const C = [], add = (id, status, title, value, fix = '') => C.push({ id, status, title, value, fix }), f = (v, d = 1) => (isFinite(v) ? v.toFixed(d) : '—');
  // a silent master has no programme loudness: loudness, stereo and dynamics checks do not apply (they used to report false FAILs)
  const silent = !isFinite(m.loudness.integrated);
  if (silent) add('silent', 'info', 'Silent master', 'No measurable programme loudness', 'Check the source file.');
  add('clip', m.samplePeakDb < -0.05 ? 'pass' : 'fail', 'No clipped samples', 'Sample peak ' + f(m.samplePeakDb, 2) + ' dBFS', 'Lower the ceiling.');
  add('tp', m.truePeak.dbtp <= S.lim.ceilingDb + 0.05 ? 'pass' : 'fail', 'True-peak ceiling', f(m.truePeak.dbtp, 2) + ' dBTP (ceiling ' + S.lim.ceilingDb + ')', 'Lower the ceiling.');
  const L = rep.loudness || {}, lim = rep.stages.lim || {};
  add('loud', silent ? 'info' : Math.abs(m.loudness.integrated - S.loud.targetLufs) <= 0.5 ? 'pass' : (L.capped ? 'info' : 'warn'), 'Loudness target', f(m.loudness.integrated) + ' LUFS (target ' + S.loud.targetLufs + ')', L.capped ? 'Capped to protect dynamics — use Loud mode or accept a quieter master.' : 'Adjust target.');
  const heavy = (L.limitingLu > S.loud.maxLimitLu + 0.5) || (lim.pctOver3dB > 25) || (lim.maxGrDb < -9);
  add('limit', heavy ? 'warn' : 'pass', 'Limiting amount', 'Limiting ' + f(L.limitingLu, 2) + ' LU · max GR ' + f(lim.maxGrDb, 1) + ' dB · GR>3 dB ' + f(lim.pctOver3dB, 1) + '% of time', 'Lower the target or use Dynamic mode.');
  const cl = rep.stages.clip || {}; add('dist', cl.bypassed || !(cl.distortionDb > -35) ? 'pass' : 'warn', 'Clipper distortion', cl.bypassed ? 'Clipper off' : f(cl.distortionDb) + ' dB re signal (' + f(cl.clippedPct, 2) + '% samples)', 'Raise clipper threshold.');
  const dc = Math.max(...m.channels.map((c) => c.dcDb)); add('dc', dc < -60 ? 'pass' : 'warn', 'DC offset', f(dc) + ' dBFS', 'Enable DC removal.');
  if (m.stereo && !silent) { const s = m.stereo, loss = m.loudness.integrated - s.monoFoldI;
    add('phase', s.correlation >= 0.2 ? 'pass' : s.correlation >= 0 ? 'warn' : 'fail', 'Phase correlation', f(s.correlation, 2) + ' (low band ' + f(s.lowCorrelation, 2) + ')', 'Reduce width / enable bass mono.');
    add('mono', loss <= 3 ? 'pass' : loss <= 4.5 ? 'warn' : 'fail', 'Mono compatibility', 'Mono fold-down −' + f(loss) + ' dB', 'Reduce width.'); }
  add('dyn', silent ? 'info' : m.plr >= 8 ? 'pass' : m.plr >= 6 ? 'warn' : 'fail', 'Dynamics (PLR)', 'PLR ' + f(m.plr) + ' dB · LRA ' + f(m.loudness.lra) + ' LU (source ' + f(o.loudness.lra) + ')', 'Use a lower target or Dynamic mode.');
  const bad = m.channels.some((c) => !isFinite(c.rmsDb));
  add('int', !bad && m.frames === o.frames && m.fs === o.fs ? 'pass' : 'fail', 'Render integrity', m.frames + ' frames @ ' + m.fs + ' Hz, ' + m.channelsCount + ' ch');
  return C;
}
