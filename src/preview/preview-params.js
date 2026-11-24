// preview-params.js: mengubah objek `settings` mesin akurat (yang diedit di rack.js) menjadi parameter angka untuk PreviewCore.
// Dijalankan di thread utama (boleh alokasi). Mendesain koefisien dengan designBiquad/butterSections yang SAMA dengan mesin.
import { designBiquad, butterSections } from '../engine/biquad.js';
import { MAXS, MAXM, MAXD } from './preview-core.js';
const co = (s) => [s.b0, s.b1, s.b2, s.a1, s.a2];
// sama dengan eqSections() mesin, tetapi dipisah: pita stereo (L/R), mid saja, side saja. Filter LTI yang sama di L dan R setara dengan di M dan S.
export function eqLists(bands, fs) {
  const lr = [], mid = [], side = [];
  for (const b of bands) {
    if (!b.on) continue; let secs;
    if (b.type === 'hp' || b.type === 'lp') secs = b.slope >= 24 ? butterSections(b.type, b.f, 4, fs) : [designBiquad(b.type, b.f, b.q || 0.7071, 0, fs)];
    else { if (Math.abs(b.g || 0) < 0.01 && b.type !== 'notch') continue; secs = [designBiquad(b.type === 'bell' ? 'peak' : b.type, b.f, b.q, b.g, fs)]; }
    const dst = b.ch === 'mid' ? mid : b.ch === 'side' ? side : lr; for (const s of secs) dst.push(co(s));
  }
  return { lr, mid, side };
}
// S: objek settings penuh (resolveSettings). opts: { autoGainDb, thrDb, outGainDb }.
// autoGainDb = gain headroom otomatis dari analisis (PreStage.autoDb); thrDb = ambang kompresor (mesin: persentil 90 level lagu + thrOffsetDb);
// outGainDb = gain loudness terakhir dari render penuh (rep.loudness.gainDb) bila ada, supaya preview setara keras dengan hasil MASTER.
export function buildParams(S, fs, opts = {}) {
  const e = eqLists(S.eq.bypass ? [] : S.eq.bands, fs), p = S.pre, c = S.comp, l = S.lim;
  const warn = []; const cut = (a, m, nm) => { if (a.length > m) { warn.push(`${nm}: ${a.length} seksi, hanya ${m} dipakai`); a.length = m; } return a; };
  const rumble = p.bypass || !p.rumble ? [] : butterSections('hp', p.rumbleHz, p.rumbleSlope >= 24 ? 4 : 2, fs).map(co);
  return {
    params: {
      preGainDb: p.bypass ? 0 : (p.inputGainDb || 0) + (opts.autoGainDb || 0), rumble: cut(rumble, 2, 'rumble'),
      eqLR: cut(e.lr, MAXS, 'EQ L/R'), eqMid: cut(e.mid, MAXM, 'EQ mid'), eqSide: cut(e.side, MAXD, 'EQ side'), outGainDb: opts.outGainDb || 0,
      comp: { bypass: !!c.bypass, thrDb: opts.thrDb ?? c.thrDb, ratio: c.ratio, kneeDb: c.kneeDb, attackMs: c.attackMs, releaseMs: c.releaseMs, autoRelease: !!c.autoRelease, rmsMs: c.rmsMs,
        scHp: c.scHpfHz > 0 ? co(designBiquad('hp', c.scHpfHz, 0.7071, 0, fs)) : null, mix: c.mix, makeupDb: c.makeupDb || 0 },
      lim: { bypass: !!l.bypass, ceilingDb: l.ceilingDb, releaseMs: l.releaseMs, autoRelease: l.autoRelease !== false, slow: ({ transparent: 5, balanced: 3, punchy: 2 })[l.style] || 3 }
    },
    warn
  };
}
