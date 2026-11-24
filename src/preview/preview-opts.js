// preview-opts.js - nilai pelengkap untuk buildParams yang di mesin akurat baru diketahui saat render (gain headroom, ambang kompresor, gain loudness).
// Setelah MASTER dipakai angka asli dari laporan render; sebelum itu dipakai TAKSIRAN (ditandai di est). Murni, bisa dites di Node.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// st: { settings, an, report, rendered }
export function previewOpts(st) {
  const s = st.settings, p = s.pre, c = s.comp, est = [], out = {};
  const lu = st.an && st.an.loudness ? st.an.loudness.integrated : NaN, rep = st.report, stg = rep && rep.stages ? rep.stages : null;
  out.autoGainDb = !p.bypass && p.autoHeadroom && isFinite(lu) ? clamp(p.refLufs - lu, -30, 30) : 0;
  if (c.autoThr !== false) {
    const rc = st.rendered && st.rendered.comp;
    if (stg && stg.comp && isFinite(stg.comp.thrDb) && rc && rc.autoThr !== false && isFinite(rc.thrOffsetDb)) out.thrDb = stg.comp.thrDb - rc.thrOffsetDb + c.thrOffsetDb;
    else if (isFinite(lu)) { out.thrDb = lu + out.autoGainDb + (p.bypass ? 0 : p.inputGainDb || 0) + 2 + c.thrOffsetDb; est.push('comp threshold'); }
  }
  if (rep && rep.loudness && isFinite(rep.loudness.gainDb)) out.outGainDb = rep.loudness.gainDb;
  else if (s.loud && !s.loud.bypass && isFinite(lu)) { out.outGainDb = clamp(s.loud.targetLufs - (lu + out.autoGainDb + (p.bypass ? 0 : p.inputGainDb || 0)), 0, 15); est.push('output gain'); }
  out.estimated = est;
  return out;
}
