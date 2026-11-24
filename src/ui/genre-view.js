// genre-view.js - daftar genre ala konsep Lintang Audio: tombol berundak, kurva mini, detail pola spektrum target. Murni string (tanpa DOM), bisa diuji di Node.
import { escHtml } from './ui-util.js';
export const WD = 320;
export const HD = 200;
export const PX = 10;
const RY = (v, h) => Math.max(1, Math.min(h - 1, ((7 - v) / 24) * h));
const n1 = (v) => v.toFixed(1);
// kurva halus Catmull-Rom -> Bezier lewat titik-titik
export function smoothPath(pts) {
  let d = 'M' + n1(pts[0][0]) + ' ' + n1(pts[0][1]);
  for (let k = 0; k < pts.length - 1; k++) {
    const p0 = pts[k - 1] || pts[k], p1 = pts[k], p2 = pts[k + 1], p3 = pts[k + 2] || p2;
    d += ' C' + n1(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + n1(p1[1] + (p2[1] - p0[1]) / 6) + ' ' + n1(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + n1(p2[1] - (p3[1] - p1[1]) / 6) + ' ' + n1(p2[0]) + ' ' + n1(p2[1]);
  }
  return d;
}
export function curveOf(rel, w, h, padX) { return smoothPath(rel.map((v, k) => [padX + (k * (w - 2 * padX)) / (rel.length - 1), RY(v, h)])); }
export const miniPath = (rel) => curveOf(rel, 60, 20, 3);
const DB_LABELS = [5, 0, -5, -10].map((v) => ({ label: (v > 0 ? '+' : '') + v + ' dB', top: Math.round((RY(v, HD) / HD) * 1000) / 10 }));
const FREQ_LABELS = ['31', '63', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'].map((label, k) => ({ label, left: Math.round(((PX + (k * (WD - 2 * PX)) / 9) / WD) * 1000) / 10 }));
// angka ringkas sebuah genre dari katalog mesin (bukan salinan: dibaca langsung dari g)
export function genreFacts(g) {
  const w = g.settings && g.settings.stereo ? g.settings.stereo.width : null;
  return { lufs: g.lufs + ' LUFS', tilt: g.tilt.toFixed(2) + ' dB/oct', width: w == null ? '—' : w + '%' };
}
// SVG pola spektrum target satu genre; cur = genre yang sedang terpilih (garis putus-putus pembanding) atau null
export function detailHtml(g, cur) {
  const rel = g.targetRel, same = cur && cur.id === g.id, pts = rel.map((v, j) => [PX + (j * (WD - 2 * PX)) / 9, RY(v, HD)]), line = smoothPath(pts);
  const fill = line + ' L' + n1(pts[9][0]) + ' ' + HD + ' L' + n1(pts[0][0]) + ' ' + HD + ' Z', f = genreFacts(g);
  const alt = 'Pola spektrum target genre ' + g.name + ': bass ' + rel[1] + ' dB, mid ' + rel[5] + ' dB, air ' + rel[9] + ' dB relatif pink noise';
  const style = (o) => ' style="' + o + '"';
  return '<div class=gdet><span class=gd>' + escHtml(g.description) + '</span>'
    + '<div class="head sp"><span class=ttl style="font-size:12px">Pola spektrum target</span><div class=legs><span class=leg><span class=dot style="background:var(--accent)"></span>Genre ini</span>' + (same || !cur ? '' : '<span class=leg><span class=dot style="background:var(--muted)"></span>Terpilih: ' + escHtml(cur.name) + '</span>') + '</div></div>'
    + '<div class=gplot><svg viewBox="0 0 ' + WD + ' ' + HD + '" preserveAspectRatio=none role=img aria-label="' + escHtml(alt) + '">'
    + '<path d="M0 33 H320 M0 83 H320 M0 133 H320 M0 167 H320"' + style('stroke:var(--soft);stroke-width:1;fill:none;vector-effect:non-scaling-stroke') + '/>'
    + '<path d="M0 58 H320"' + style('stroke:var(--muted);stroke-width:1;stroke-dasharray:4 4;fill:none;vector-effect:non-scaling-stroke') + '/>'
    + (same || !cur ? '' : '<path d="' + curveOf(cur.targetRel, WD, HD, PX) + '"' + style('stroke:var(--muted);stroke-width:2;stroke-dasharray:5 4;fill:none;vector-effect:non-scaling-stroke') + '/>')
    + '<path d="' + fill + '"' + style('fill:var(--accent);opacity:.18;stroke:none') + '/>'
    + '<path d="' + line + '"' + style('stroke:var(--accent);stroke-width:3;fill:none;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke') + '/></svg>'
    + DB_LABELS.map((d) => '<span class="vl y" style="top:' + d.top + '%">' + d.label + '</span>').join('')
    + FREQ_LABELS.map((d) => '<span class="vl x" style="left:' + d.left + '%">' + d.label + '</span>').join('') + '</div>'
    + '<span class=small style="font-size:11px">Target per oktaf (31,5 Hz - 16 kHz) relatif terhadap pink noise = 0 dB, dinormalkan di 250 Hz - 2 kHz. Titik awal, belum dikalibrasi dengan audio referensi.</span>'
    + '<div class=stats><div class=stat><span class=lbl>Loudness</span><span>' + escHtml(f.lufs) + '</span></div><div class=stat><span class=lbl>Tilt</span><span>' + escHtml(f.tilt) + '</span></div><div class=stat><span class=lbl>Lebar stereo</span><span>' + escHtml(f.width) + '</span></div></div>'
    + '<button class=pill data-use="' + escHtml(g.id) + '"' + (same ? ' disabled' : '') + '>' + (same ? 'SUDAH DIPILIH' : 'PAKAI GENRE INI') + '</button></div>';
}
// daftar genre satu kategori; openId = genre yang dibuka (detail), curId = genre terpilih
export function genreListHtml(genres, curId, openId) {
  const cur = genres.find((g) => g.id === curId) || null;
  return genres.map((g, i) => {
    const on = g.id === curId, exp = g.id === openId, cls = 'gitem' + (i % 2 ? ' odd' : '') + (on ? ' on' : '') + (exp ? ' exp' : '');
    return '<div class="' + cls + '"><button class=gbtn data-toggle="' + escHtml(g.id) + '" aria-expanded="' + exp + '"><span class=gn>' + escHtml(g.name) + '</span>'
      + '<svg viewBox="0 0 60 20" aria-hidden=true><path d="' + miniPath(g.targetRel) + '"/></svg><span class=gi>' + String(i + 1).padStart(2, '0') + '</span>'
      + '<svg class=gc viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=3 stroke-linecap=round stroke-linejoin=round aria-hidden=true><path d="M6 9l6 6 6-6"/></svg></button>'
      + (exp ? detailHtml(g, cur) : '') + '</div>';
  }).join('') + '<div style="height:1.5px;flex:none;background:var(--text)"></div>';
}
