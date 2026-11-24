// rack.js - mode Advanced ala konsep Lintang Audio: 12 stage sebagai unit rak (LCD, knob, fader, bypass).
// Murni string (tanpa DOM, bisa diuji di Node). Aturan AGENTS.md: setiap kontrol menunjuk ke SATU setting yang benar-benar dibaca mesin
// (atribut data-p / data-tog / data-set berisi path ke objek settings); kontrol yang pada kondisi tertentu tidak berpengaruh dibuat disabled.
import { eqSections } from '../engine/modules.js';
import { sectionsMagDb } from '../engine/biquad.js';
import { escHtml } from './ui-util.js';
const esc = escHtml, cl = (v, a, b) => Math.min(b, Math.max(a, v)), rd = (v) => Math.round(v * 1000) / 1000;
export const getPath = (o, p) => String(p).split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
export const dbF = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(v).toFixed(d) + ' dB';
export const hzF = (f) => (f >= 1000 ? (f / 1000).toFixed(2).replace(/\.?0+$/, '') + ' kHz' : Math.round(f) + ' Hz');
// format tampilan nilai per jenis (dipakai juga oleh app.js untuk memperbarui angka saat fader digeser)
export const FMT = { db: (v) => dbF(v), db0: (v) => dbF(v, 0), hz: hzF, pct: (v) => v + ' %', ms: (v) => v + ' ms', lufs: (v) => v.toFixed(1) + ' LUFS', lu: (v) => v.toFixed(1) + ' LU', x: (v) => v.toFixed(1) + ':1', n1: (v) => v.toFixed(1), n2: (v) => v.toFixed(2), plain: (v) => String(v), dbn: (v) => v + ' dB', q: (v) => v.toFixed(1) };
const fmt = (k, v) => (isFinite(v) ? (FMT[k] || FMT.plain)(v) : '—');
const lg = (f) => Math.log(f / 20) / Math.log(1000);
const sig = (x) => 1 / (1 + Math.exp(-x));
const tok = (c) => 'var(--' + c + ')';
// ---------- komponen kecil ----------
function geo(fr) {
  fr = cl(fr, 0, 1); const pt = (deg, r) => { const a = deg * Math.PI / 180; return [(38 + r * Math.sin(a)).toFixed(1), (38 - r * Math.cos(a)).toFixed(1)]; };
  let t = '', on = '';
  for (let i = 0; i <= 10; i++) { const d = -135 + 27 * i, p1 = pt(d, 29), p2 = pt(d, 34), seg = 'M' + p1[0] + ' ' + p1[1] + 'L' + p2[0] + ' ' + p2[1]; if (i / 10 <= fr + 0.001) on += seg; else t += seg; }
  return { t, on, n1: pt(-135 + 270 * fr, 8), n2: pt(-135 + 270 * fr, 22) };
}
function knobSvg(fr, small) {
  const g = geo(fr);
  return '<svg viewBox="0 0 76 76" aria-hidden=true><path class=k-tick stroke-width=' + (small ? 2 : 1.5) + ' d="' + g.t + '"/><path class=k-on stroke-width=' + (small ? 2.5 : 2) + ' d="' + g.on + '"/><circle class=k-body cx=38 cy=38 r=25 />'
    + (small ? '' : '<circle class=k-ring cx=38 cy=38 r=19 />') + '<line class=k-needle x1=' + g.n1[0] + ' y1=' + g.n1[1] + ' x2=' + g.n2[0] + ' y2=' + g.n2[1] + ' stroke-width=' + (small ? 4 : 3.5) + ' /></svg>';
}
const stepBtns = (o, v) => ['-1', '1'].map((d) => '<button data-p="' + o.p + '" data-d=' + d + ' data-min=' + o.min + ' data-max=' + o.max + ' data-st=' + (o.st || 1) + (o.mul ? ' data-mul=' + o.mul : '') + (o.dis ? ' disabled' : '') + ' aria-label="' + (d === '1' ? 'Tambah ' : 'Kurangi ') + esc(o.label) + '">' + (d === '1' ? '+' : '-') + '</button>').join('');
// knob: o = { p: path setting, label, min, max, st (langkah) | mul (pengali), k: jenis format, dim: dibuat redup tapi tetap bisa, dis: mati }
function knob(s, o) {
  const v = getPath(s, o.p), fr = o.log ? lg(v) : (v - o.min) / (o.max - o.min);
  return '<div class="kn' + (o.dis ? ' dim' : '') + '"' + (o.title ? ' title="' + esc(o.title) + '"' : '') + '><span class=cap>' + esc(o.label) + '</span>' + knobSvg(fr) + '<span class=kv data-rd="' + o.p + '" data-k=' + o.k + '>' + fmt(o.k, v) + '</span><div class=stp>' + stepBtns(o, v) + '</div></div>';
}
function fader(s, o) {
  const v = getPath(s, o.p);
  return '<div><div class=frow><span class=cap>' + esc(o.label) + '</span><span class=kv data-rd="' + o.p + '" data-k=' + o.k + '>' + fmt(o.k, v) + '</span></div><input class=fdr type=range data-p="' + o.p + '" data-k=' + o.k + ' min=' + o.min + ' max=' + o.max + ' step=' + o.st + ' value=' + v + ' aria-label="' + esc(o.label) + '"></div>';
}
const tog = (s, p, label) => '<button class=tg data-tog="' + p + '" aria-pressed=' + !!getPath(s, p) + ' aria-label="' + esc(label) + '"><i></i>' + esc(label) + '</button>';
const group = (label, items) => '<div class=sg><span class=cap>' + esc(label) + '</span><div class=row>' + items + '</div></div>';
const opts = (s, p, list) => list.map(([name, val]) => '<button class=opt data-set="' + p + '" data-v="' + val + '" data-t=' + typeof val + ' aria-pressed=' + (getPath(s, p) === val) + ' aria-label="' + esc(name) + '">' + esc(name) + '</button>').join('');
const key = (name, on, selected, ui, v) => '<button class="key' + (selected ? ' sel' : '') + (on ? ' lit' : '') + '" data-ui="' + ui + '" data-v=' + v + ' aria-label="' + esc(name) + (on ? ' aktif' : ' mati') + '">' + esc(name) + '<i></i></button>';
const leds = (lit, total = 12, hi = 8) => '<div class=bar>' + Array.from({ length: total }, (_, i) => '<i class="' + (i < lit ? (i < hi ? 'on' : 'hi') : '') + '"></i>').join('') + '</div>';
const ledRow = (label, lit, read, hi) => '<div class=ledrow><span class=cap>' + label + '</span>' + leds(lit, 12, hi == null ? 12 : hi) + '<span class=rd>' + read + '</span></div>';
const swBtn = (p, on, title) => '<button class=sw data-tog="' + p + '" aria-pressed=' + !!on + ' aria-label="' + esc(title) + ' bypass"><span class=led></span><span class=swtrack><span class=swlever></span></span>BYPASS</button>';
// ---------- LCD (viewBox 282 x 100; teks diposisikan HTML di atas SVG supaya tidak ikut membesar) ----------
const PX = (fr) => 14 + 254 * fr, PY = (fr) => 84 - 76 * fr;
const L = (x1, y1, x2, y2, o = {}) => '<line x1=' + x1.toFixed(1) + ' y1=' + y1.toFixed(1) + ' x2=' + x2.toFixed(1) + ' y2=' + y2.toFixed(1) + ' style="stroke:' + tok(o.c || 'soft') + ';stroke-width:' + (o.sw || 1) + (o.dash ? ';stroke-dasharray:' + o.dash : '') + '"/>';
const R = (x, y, w, h, c, fo = 1) => '<rect x=' + x.toFixed(1) + ' y=' + y.toFixed(1) + ' width=' + Math.max(0, w).toFixed(1) + ' height=' + Math.max(0, h).toFixed(1) + ' style="fill:' + tok(c) + ';fill-opacity:' + fo + '"/>';
const P = (d, o = {}) => '<path d="' + d + '" style="fill:' + (o.fill ? tok(o.fill) : 'none') + ';fill-opacity:' + (o.fo == null ? 1 : o.fo) + ';stroke:' + (o.c === 'none' ? 'none' : tok(o.c || 'text')) + ';stroke-width:' + (o.sw || 1.5) + ';stroke-linejoin:round"/>';
const T = (x, y, t, o = {}) => '<span class=tx style="left:' + (x / 282 * 100).toFixed(2) + '%;top:' + y + '%;transform:translate(' + (o.a === 'end' ? '-100%' : o.a === 'mid' ? '-50%' : '0') + ',-82%);font-size:' + (o.size || 9) + 'px;font-weight:' + (o.w || 400) + ';color:' + tok(o.c || 'text') + '">' + esc(t) + '</span>';
const poly = (pts) => 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L');
const axes = () => L(14, 84, 268, 84, { c: 'line' }) + L(14, 8, 14, 84, { c: 'line' });
const lcd = (label, shapes, texts) => '<div class=lcd><div class=in><svg viewBox="0 0 282 100" role=img aria-label="' + esc(label) + '">' + shapes + '</svg>' + texts + '</div></div>';
// ---------- unit rak ----------
const num2 = (n) => String(n).padStart(2, '0');
function unit(c, n, k, title, code, body, o = {}) {
  const st = k ? c.s[k] : null, byp = st && st.bypass, open = c.ui.open[n] === undefined ? false : c.ui.open[n];
  return '<div' + (k ? ' data-u=' + k : '') + ' class="unit' + (byp ? ' byp' : '') + '"><i class="scr tl"></i><i class="scr tr"></i><i class="scr bl"></i><i class="scr br"></i><div class=uhead><button class=utitle data-open=' + n + ' aria-expanded=' + open + ' aria-label="' + (open ? 'Tutup ' : 'Buka ') + esc(title) + '"><span class=snum>' + num2(n) + '</span><span class=uname>' + esc(title) + '</span><span class=car>' + (open ? '-' : '+') + '</span></button>'
    + (o.noSw ? '' : swBtn(k + '.bypass', byp, title)) + '</div>' + (open ? '<div class=ubody>' + body + '<div class=ufoot>' + code + '</div></div>' : '') + '</div>';
}
const rep = (c, k) => (c.report && c.report.stages ? c.report.stages[k] : null);
const knobsGrid = (arr) => '<div class=kgrid>' + arr.join('') + '</div>';
// 01 Pre-processing
function uPre(c) {
  const s = c.s, p = s.pre, inL = c.an && isFinite(c.an.loudness.integrated) ? c.an.loudness.integrated : NaN;
  const auto = p.autoHeadroom && isFinite(inL) ? cl(p.refLufs - inL, -30, 30) : 0, gain = (p.inputGainDb || 0) + auto, after = inL + gain, bar = (v) => cl((v + 30) / 30, 0, 1);
  const ok = isFinite(inL);
  const shapes = R(14, 30, 254, 8, 'soft', 0.6) + (ok ? R(14, 30, 254 * bar(inL), 8, 'text') : '') + R(14, 48, 254, 8, 'soft', 0.6) + (ok ? R(14, 48, 254 * bar(after), 8, 'accent') : '') + L(PX(bar(p.refLufs)), 26, PX(bar(p.refLufs)), 60, { c: 'accent', dash: '2 3' });
  const texts = T(14, 18, 'IN ' + (ok ? inL.toFixed(1) : '—') + ' LUFS', { size: 12, w: 600 }) + T(268, 18, 'GAIN ' + (ok ? dbF(gain) : '—'), { a: 'end', size: 12, w: 600, c: 'accent' }) + T(14, 72, 'OUT ' + (ok ? after.toFixed(1) : '—') + ' LUFS', { c: 'muted' }) + T(268, 72, 'REF ' + p.refLufs, { a: 'end', c: 'muted' }) + T(14, 96, '-30', { c: 'muted' }) + T(268, 96, '0 dBFS', { a: 'end', c: 'muted' });
  return unit(c, 1, 'pre', 'Pre-processing', 'LA-01 PRE', lcd('Level input dan gain pre-processing', shapes, texts)
    + knobsGrid([knob(s, { p: 'pre.inputGainDb', label: 'INPUT', min: -12, max: 12, st: 0.5, k: 'db' }), knob(s, { p: 'pre.refLufs', label: 'REF LUFS', min: -30, max: -6, st: 1, k: 'plain', dis: !p.autoHeadroom }), knob(s, { p: 'pre.rumbleHz', label: 'RUMBLE', min: 10, max: 60, st: 1, k: 'hz', dis: !p.rumble })])
    + group('RUMBLE SLOPE', opts(s, 'pre.rumbleSlope', [['12 dB', 12], ['24 dB', 24]]))
    + '<div class=tgs>' + tog(s, 'pre.autoHeadroom', 'AUTO HEADROOM') + tog(s, 'pre.dcRemove', 'DC REMOVE') + tog(s, 'pre.rumble', 'RUMBLE HPF') + '</div>');
}
// 02 Corrective EQ (panel plugin)
const TYPES = [['HP', 'hp'], ['LOW SH', 'lowshelf'], ['BELL', 'bell'], ['HI SH', 'highshelf'], ['LP', 'lp'], ['NOTCH', 'notch']];
export function newBand() { return { on: true, type: 'bell', f: 1000, g: 0, q: 1, ch: 'stereo', auto: false }; }
function stage(c, n, k, title, inner) {
  const st = c.s[k], byp = st.bypass, open = c.ui.open[n] === undefined ? false : c.ui.open[n];
  return '<div' + (k ? ' data-u=' + k : '') + ' class="stage' + (byp ? ' byp' : '') + '"><i class="scr tl"></i><i class="scr tr"></i><i class="scr bl"></i><i class="scr br"></i><div class=uhead><button class=utitle data-open=' + n + ' aria-expanded=' + open + ' aria-label="' + (open ? 'Tutup ' : 'Buka ') + esc(title) + '"><span class=snum>' + num2(n) + '</span><span class=uname>' + esc(title) + '</span><span class=car>' + (open ? '-' : '+') + '</span></button>' + swBtn(k + '.bypass', byp, title) + '</div>' + (open ? '<div class=sbody>' + inner + '</div>' : '') + '</div>';
}
function uEq(c) {
  const s = c.s, e = s.eq, bands = e.bands, fs = c.fs, i = cl(c.ui.eqSel, 0, Math.max(0, bands.length - 1)), b = bands[i];
  const X = (f) => 15 + lg(f) * 320, Y = (g) => 75 - cl(g, -12, 12) * 5.5, secs = eqSections(bands, fs).mid;
  let line = '', fill = '';
  for (let j = 0; j <= 64; j++) { const f = 20 * Math.pow(1000, j / 64), g = e.bypass || !secs.length ? 0 : sectionsMagDb(secs, Math.min(f, fs * 0.45), fs), seg = (j ? 'L' : 'M') + X(f).toFixed(1) + ' ' + Y(isFinite(g) ? g : 0).toFixed(1) + ' '; line += seg; fill += seg; }
  fill += 'L335 75 L15 75 Z';
  const tx = (x, y, t) => '<text x=' + x + ' y=' + y + ' font-size=8 class=lt style="fill:var(--muted)">' + t + '</text>', ln = (x1, y1, x2, y2, dash) => '<line x1=' + x1 + ' y1=' + y1 + ' x2=' + x2 + ' y2=' + y2 + ' style="stroke:var(--' + (dash ? 'soft' : 'muted') + ');stroke-width:1' + (dash ? ';stroke-dasharray:2 4' : '') + '"/>';
  const svg = '<svg class=eqsvg viewBox="0 0 350 150" role=img aria-label="Kurva respons EQ">' + ln(15, 75, 335, 75) + ln(15, 42, 335, 42, 1) + ln(15, 108, 335, 108, 1) + ln(90, 10, 90, 140, 1) + ln(196, 10, 196, 140, 1) + ln(303, 10, 303, 140, 1) + tx(92, 146, '100') + tx(198, 146, '1k') + tx(305, 146, '10k') + tx(17, 40, '+6') + tx(17, 106, '-6')
    + '<path d="' + fill + '" style="fill:var(--accent);fill-opacity:.16;stroke:none"/><path d="' + line + '" style="fill:none;stroke:var(--text);stroke-width:2;stroke-linejoin:round"/>'
    + bands.map((q, j) => '<circle cx=' + X(q.f).toFixed(1) + ' cy=' + Y(q.type === 'bell' || q.type === 'lowshelf' || q.type === 'highshelf' ? q.g : 0).toFixed(1) + ' r=' + (j === i ? 7 : 5) + ' style="fill:var(' + (j === i ? '--accent' : '--panel') + ');stroke:var(--text);stroke-width:1.5;opacity:' + (q.on ? 1 : 0.4) + '"/>').join('') + '</svg>';
  const tabs = bands.map((q, j) => '<button data-ui=eqSel data-v=' + j + ' class="' + (j === i ? 'on ' : '') + (q.on ? '' : 'byp') + '" aria-label="Band ' + (j + 1) + ' ' + q.type + (q.auto ? ' otomatis' : '') + '" title="' + (q.auto ? 'Dibuat otomatis oleh Adaptive correction' : 'Band ' + (j + 1)) + '">' + (j + 1) + (q.auto ? '<sup>A</sup>' : '') + '</button>').join('') + '<button data-add=eq.bands aria-label="Tambah band EQ">+</button>';
  let ctl = '';
  if (b) {
    const p = 'eq.bands.' + i, tgain = b.type === 'bell' || b.type === 'lowshelf' || b.type === 'highshelf', hl = b.type === 'hp' || b.type === 'lp', qdead = hl && b.slope >= 24;
    ctl = '<div class=typesrow>' + TYPES.map(([nm, t]) => '<button class="' + (b.type === t ? 'on' : '') + '" data-set="' + p + '.type" data-v=' + t + ' data-t=string>' + nm + '</button>').join('') + '</div>'
      + '<div class=typesrow><button class="' + (b.on ? 'on' : '') + '" data-tog="' + p + '.on" aria-pressed=' + !!b.on + '>' + (b.on ? 'BAND ON' : 'BAND OFF') + '</button>'
      + [['ST', 'stereo'], ['MID', 'mid'], ['SIDE', 'side']].map(([nm, v]) => '<button class="' + ((b.ch || 'stereo') === v ? 'on' : '') + '" data-set="' + p + '.ch" data-v=' + v + ' data-t=string>' + nm + '</button>').join('')
      + (hl ? [['12 dB', 12], ['24 dB', 24]].map(([nm, v]) => '<button class="' + ((b.slope >= 24 ? 24 : 12) === v ? 'on' : '') + '" data-set="' + p + '.slope" data-v=' + v + ' data-t=number>' + nm + '</button>').join('') : '')
      + '<button data-del=' + i + ' aria-label="Hapus band ' + (i + 1) + '">REMOVE</button></div>'
      + '<div class=kfoot>' + knob(s, { p: p + '.f', label: 'FREQ', min: 20, max: 20000, mul: 1.08, k: 'hz', log: 1 }) + knob(s, { p: p + '.g', label: 'GAIN', min: -12, max: 12, st: 0.5, k: 'db', dis: !tgain }) + knob(s, { p: p + '.q', label: 'Q', min: 0.3, max: 10, st: 0.1, k: 'q', dis: qdead, title: qdead ? 'Slope 24 dB memakai filter Butterworth tetap, Q tidak dipakai' : '' }) + '</div>';
  } else ctl = '<div class=typesrow><span class=small>Tidak ada band EQ. Tekan + untuk menambah.</span></div>';
  return stage(c, 2, 'eq', 'Corrective EQ', '<div class=pad>' + svg + '</div><div class=tabs>' + tabs + '</div>' + ctl + '<div class=typesrow style="border-top:1px solid var(--soft)"><span class=cap style="flex:1 1 100%">PHASE</span>' + [['MINIMUM', 'minimum'], ['LINEAR', 'linear']].map(([nm, v]) => '<button class="' + (e.phase === v ? 'on' : '') + '" data-set=eq.phase data-v=' + v + ' data-t=string>' + nm + '</button>').join('') + '</div>');
}
// 03 Dynamic EQ
function uDyn(c) {
  const s = c.s, d = s.dyneq, r = rep(c, 'dyneq'), auto = d.autoThr !== false;
  const rows = d.bands.map((b, i) => {
    const p = 'dyneq.bands.' + i, on = b.on && !d.bypass, rb = r && r.bands ? r.bands[i] : null, gr = rb && isFinite(rb.maxGrDb) ? Math.abs(rb.maxGrDb) : NaN;
    const kn = (o) => { const v = getPath(s, o.p), dis = !!o.dis; return '<div class=kb style="opacity:' + (dis ? 0.35 : 1) + '">' + knobSvg((v - o.min) / (o.max - o.min), 1) + '<span data-rd="' + o.p + '" data-k=' + o.k + '>' + fmt(o.k, v) + '</span><span class=cap>' + o.label + '</span><div class=stp>' + stepBtns(Object.assign({ label: b.name + ' ' + o.label }, o, { dis }), v) + '</div></div>'; };
    const thrShown = auto && rb ? '<div class=kb style="opacity:.35">' + knobSvg((rb.thrDb + 60) / 60, 1) + '<span>' + rb.thrDb + ' dB</span><span class=cap>THR AUTO</span></div>' : kn({ p: p + '.thrDb', label: 'THR', min: -60, max: 0, st: 1, k: 'db0', dis: auto });
    return '<div class="dynrow' + (b.on ? '' : ' off') + '"><div class=hd><button class=onb data-tog="' + p + '.on" aria-pressed=' + !!b.on + ' aria-label="' + esc(b.name) + (b.on ? ' aktif' : ' mati') + '">' + (b.on ? 'ON' : 'OFF') + '</button><span class=nm>' + esc(b.name) + '</span><span class=fq>' + hzF(b.f) + '</span></div>'
      + '<div class=kk>' + thrShown + kn({ p: p + '.ratio', label: 'RATIO', min: 1, max: 10, st: 0.1, k: 'x' }) + kn({ p: p + '.offsetDb', label: 'OFFSET', min: 0, max: 12, st: 0.5, k: 'db', dis: !auto }) + '</div>'
      + ledRow('GR', on && isFinite(gr) ? Math.round(cl(gr / 6, 0, 1) * 12) : 0, isFinite(gr) && on ? '-' + gr.toFixed(1) + ' dB' : '—', 8) + '</div>';
  }).join('');
  return stage(c, 3, 'dyneq', 'Dynamic EQ', rows + '<div class=typesrow style="border-top:1px solid var(--soft)">' + tog(s, 'dyneq.autoThr', 'AUTO THR (ukur dari lagu)') + '</div>');
}
// 04 Bus compression
function uComp(c) {
  const s = c.s, p = s.comp, r = rep(c, 'comp'), auto = p.autoThr !== false;
  const thr = auto ? (r && isFinite(r.thrDb) ? r.thrDb : NaN) : p.thrDb, ratio = p.ratio, kn = p.kneeDb, mu = p.makeupDb || 0;
  const outF = (x) => { const d = x - thr; if (kn <= 0) return d <= 0 ? x : thr + d / ratio; if (2 * d < -kn) return x; if (2 * Math.abs(d) <= kn) return x + (1 / ratio - 1) * Math.pow(d + kn / 2, 2) / (2 * kn); return thr + d / ratio; };
  const t0 = isFinite(thr) ? thr : -100, pts = []; for (let x = -40; x <= 0; x += 2) pts.push([PX((x + 40) / 40), PY(cl((outF(x) + mu + 40) / 40, 0, 1))]);
  const tx = PX((thr + 40) / 40), gr = r && isFinite(r.maxGrDb) ? Math.abs(r.maxGrDb) : NaN;
  const shapes = axes() + L(14, 84, 268, 8, { dash: '2 3' }) + (isFinite(thr) ? L(tx, 8, tx, 84, { c: 'accent', dash: '2 3' }) : '') + (isFinite(thr) ? P(poly(pts), { sw: 2 }) : '');
  const texts = T(20, 17, 'OUT', { c: 'muted' }) + T(268, 96, 'IN dB', { a: 'end', c: 'muted' }) + (isFinite(thr) ? T(tx + (tx > 200 ? -4 : 4), 20, 'THR ' + thr.toFixed(0), { c: 'accent', a: tx > 200 ? 'end' : 'start' }) : T(268, 20, 'THR AUTO (setelah render)', { c: 'accent', a: 'end' }));
  void t0;
  return unit(c, 4, 'comp', 'Bus compression', 'LA-04 BUS COMP', lcd('Kurva transfer kompresor bus', shapes, texts)
    + knobsGrid([auto ? knob(s, { p: 'comp.thrOffsetDb', label: 'THR OFFSET', min: -12, max: 0, st: 0.5, k: 'db' }) : knob(s, { p: 'comp.thrDb', label: 'THRESH', min: -60, max: 0, st: 1, k: 'db0' }),
      knob(s, { p: 'comp.ratio', label: 'RATIO', min: 1, max: 10, st: 0.1, k: 'x' }), knob(s, { p: 'comp.attackMs', label: 'ATTACK', min: 1, max: 100, st: 1, k: 'ms' }), knob(s, { p: 'comp.releaseMs', label: 'RELEASE', min: 10, max: 1000, st: 10, k: 'ms' }),
      knob(s, { p: 'comp.kneeDb', label: 'KNEE', min: 0, max: 12, st: 1, k: 'dbn' }), knob(s, { p: 'comp.makeupDb', label: 'MAKEUP', min: 0, max: 12, st: 0.5, k: 'db' })])
    + '<div style="display:flex;flex-direction:column;gap:2px">' + fader(s, { p: 'comp.mix', label: 'MIX', min: 0, max: 100, st: 1, k: 'pct' }) + fader(s, { p: 'comp.scHpfHz', label: 'SC HPF', min: 20, max: 300, st: 5, k: 'hz' }) + '</div>'
    + '<div class=tgs>' + tog(s, 'comp.autoThr', 'AUTO THR') + tog(s, 'comp.autoRelease', 'AUTO RELEASE') + '</div>'
    + ledRow('GR', isFinite(gr) ? Math.round(cl(gr / 12, 0, 1) * 12) : 0, isFinite(gr) ? '-' + gr.toFixed(1) + ' dB' : '—', 8));
}
// 05 Multiband
function uMb(c) {
  const s = c.s, m = s.mb, names = ['LOW', 'LO-MID', 'HI-MID', 'HIGH'], sl = cl(c.ui.mbSel, 0, 3), xo = m.xover, xs = [14, PX(lg(xo[0])), PX(lg(xo[1])), PX(lg(xo[2])), 268], r = rep(c, 'mb'), auto = m.autoThr !== false;
  let rects = ''; names.forEach((nm, i) => { const on = m.bands[i].on, x = xs[i] + (i ? 1 : 0), w = xs[i + 1] - xs[i] - (i ? 1 : 0) - (i < 3 ? 1.5 : 0), rb = r && r.bands ? r.bands[i] : null, gr = rb && isFinite(rb.maxGrDb) ? Math.abs(rb.maxGrDb) : 0;
    rects += R(x, 30, w, 54, i === sl ? 'text' : 'soft', on ? 0.95 : 0.3) + (on && gr > 0 ? R(x, 8, w, Math.min(22, gr * 10), 'accent', 0.9) : ''); });
  const fx = (k) => (k >= 1000 ? k / 1000 + 'k' : String(k)), b = 'mb.bands.' + sl;
  const shapes = rects + L(14, 84, 268, 84, { c: 'line' }) + xs.slice(1, 4).map((x) => L(x, 8, x, 84, { c: 'line', dash: '2 3' })).join('');
  const texts = T(14, 96, '20', { c: 'muted' }) + xo.map((f, i) => T(xs[i + 1], 96, fx(f), { a: 'mid', c: 'muted' })).join('') + T(268, 96, '20k', { a: 'end', c: 'muted' });
  return unit(c, 5, 'mb', 'Multiband compression', 'LA-05 MB COMP', lcd('Empat band multiband dengan crossover; blok oranye di atas menunjukkan gain reduction hasil render terakhir', shapes, texts)
    + '<div class=keys>' + names.map((nm, i) => key(nm, m.bands[i].on, i === sl, 'mbSel', i)).join('') + '</div>'
    + knobsGrid([auto ? knob(s, { p: b + '.thrOffsetDb', label: 'THR OFFSET', min: -12, max: 0, st: 0.5, k: 'db' }) : knob(s, { p: b + '.thrDb', label: 'THRESH', min: -60, max: 0, st: 1, k: 'db0' }),
      knob(s, { p: b + '.ratio', label: 'RATIO', min: 1, max: 6, st: 0.1, k: 'x' }), knob(s, { p: b + '.attackMs', label: 'ATTACK', min: 1, max: 100, st: 1, k: 'ms' }), knob(s, { p: b + '.releaseMs', label: 'RELEASE', min: 10, max: 500, st: 10, k: 'ms' }), knob(s, { p: b + '.gainDb', label: 'GAIN', min: -6, max: 6, st: 0.5, k: 'db' })])
    + '<div style="display:flex;flex-direction:column;gap:2px">' + fader(s, { p: 'mb.xover.0', label: 'XOVER 1', min: 40, max: 300, st: 5, k: 'hz' }) + fader(s, { p: 'mb.xover.1', label: 'XOVER 2', min: 300, max: 3000, st: 50, k: 'hz' }) + fader(s, { p: 'mb.xover.2', label: 'XOVER 3', min: 2000, max: 12000, st: 100, k: 'hz' }) + '</div>'
    + '<div class=tgs>' + tog(s, b + '.on', 'BAND ' + names[sl] + ' ON') + tog(s, 'mb.autoThr', 'AUTO THR') + '</div>');
}
// 06 Saturation
const SATS = [['tape', 'TAPE'], ['tube', 'TUBE'], ['transformer', 'XFMR'], ['soft', 'SOFT'], ['exciter', 'EXCITER']];
function uSat(c) {
  const s = c.s, sa = s.sat, sl = cl(c.ui.satSel, 0, 4), id = SATS[sl][0], isE = id === 'exciter', o = sa[id], on = !!o.on, rp = rep(c, 'sat');
  let shapes, texts, kn;
  if (isE) {
    shapes = ''; for (let i = 0; i < 8; i++) { const h = (o.amount / 10) * 56 / (1 + i * 0.55) + 3; shapes += R(22 + i * 31, 84 - h, 20, h, 'text', on ? 1 : 0.35); }
    shapes += L(14, 84, 268, 84, { c: 'line' });
    texts = T(14, 17, 'HARMONICS > ' + hzF(o.freq), { c: 'muted' }) + T(268, 17, on ? 'ACTIVE' : 'OFF', { a: 'end', w: 600, c: on ? 'accent' : 'muted' }) + [2, 3, 4, 5, 6, 7, 8, 9].map((h, i) => T(32 + i * 31, 96, 'H' + h, { a: 'mid', c: 'muted' })).join('');
    kn = [knob(s, { p: 'sat.exciter.freq', label: 'FREQ', min: 2000, max: 16000, st: 500, k: 'hz' }), knob(s, { p: 'sat.exciter.amount', label: 'AMOUNT', min: 0, max: 10, st: 0.5, k: 'n1' })];
  } else {
    const k = Math.pow(10, o.driveDb / 20) * 1.6, m = (o.mix == null ? 100 : o.mix) / 100, bs = id === 'tube' ? (o.bias == null ? 0.2 : o.bias) * 0.5 : 0, f = (x) => (Math.tanh(k * (x + bs)) - Math.tanh(k * bs)) / Math.tanh(Math.min(4, k * (1 + bs))), pts = [];
    for (let x = -1; x <= 1.001; x += 0.1) pts.push([PX((x + 1) / 2), PY(cl(((1 - m) * x + m * f(x) + 1) / 2, 0, 1))]);
    shapes = L(14, 84, 268, 8, { dash: '2 3' }) + L(141, 8, 141, 84, { c: 'line' }) + L(14, 46, 268, 46, { c: 'line' }) + P(poly(pts), { sw: 2, c: on ? 'text' : 'muted' });
    texts = T(20, 17, SATS[sl][1] + ' / ' + dbF(o.driveDb), { c: 'muted' }) + T(268, 17, on ? 'ACTIVE' : 'OFF', { a: 'end', w: 600, c: on ? 'accent' : 'muted' }) + T(268, 96, 'IN', { a: 'end', c: 'muted' });
    kn = [knob(s, { p: 'sat.' + id + '.driveDb', label: 'DRIVE', min: 0, max: 12, st: 0.5, k: 'db' }), knob(s, { p: 'sat.' + id + '.mix', label: 'MIX', min: 0, max: 100, st: 5, k: 'pct' })];
    if (id === 'tube') kn.push(knob(s, { p: 'sat.tube.bias', label: 'BIAS', min: 0, max: 0.6, st: 0.05, k: 'n2' }));
  }
  void rp;
  return unit(c, 6, 'sat', 'Saturation & harmonics', 'LA-06 SATURATOR', lcd('Perkiraan kurva saturasi atau harmonik mode terpilih', shapes, texts)
    + '<div class=keys>' + SATS.map(([i2, nm], i) => key(nm, !!sa[i2].on, i === sl, 'satSel', i)).join('') + '</div>' + knobsGrid(kn)
    + group('OVERSAMPLE', opts(s, 'sat.os', [['1x', 1], ['2x', 2], ['4x', 4]]))
    + '<div class=tgs>' + tog(s, 'sat.' + id + '.on', SATS[sl][1] + ' ACTIVE') + tog(s, 'sat.autoGain', 'AUTO GAIN') + '</div>');
}
// 07 Stereo
function uStereo(c) {
  const s = c.s, p = s.stereo, w = p.width, rx = 6 + (w / 200) * 52, A = c.man || c.an, corr = A && A.stereo ? A.stereo.correlation : NaN;
  const ell = 'M' + (141 - rx).toFixed(1) + ' 46A' + rx.toFixed(1) + ' 36 0 1 0 ' + (141 + rx).toFixed(1) + ' 46A' + rx.toFixed(1) + ' 36 0 1 0 ' + (141 - rx).toFixed(1) + ' 46Z';
  const shapes = L(141, 6, 141, 86, { c: 'line' }) + L(60, 46, 222, 46, { c: 'line' }) + L(14, 94, 268, 94) + P(ell, { fill: 'accent', fo: 0.18, sw: 1.5 }) + (isFinite(corr) ? R(141, 88, 127 * cl(corr, 0, 1), 6, 'accent') : '');
  const texts = T(141, 12, 'M', { a: 'mid', c: 'muted' }) + T(66, 44, 'L', { c: 'muted' }) + T(212, 44, 'R', { c: 'muted' }) + T(14, 17, 'WIDTH ' + w + '%', { size: 12, w: 600 }) + T(268, 17, 'CORR ' + (isFinite(corr) ? (corr > 0 ? '+' : '') + corr.toFixed(2) : '—'), { a: 'end', size: 12, w: 600, c: 'accent' });
  return unit(c, 7, 'stereo', 'Stereo image', 'LA-07 IMAGER', lcd('Elips lebar stereo dan korelasi', shapes, texts)
    + knobsGrid([knob(s, { p: 'stereo.width', label: 'WIDTH', min: 0, max: 200, st: 5, k: 'pct' }), knob(s, { p: 'stereo.bassMonoHz', label: 'BASS MONO', min: 20, max: 300, st: 5, k: 'hz' }), knob(s, { p: 'stereo.monoAmount', label: 'MONO AMT', min: 0, max: 100, st: 5, k: 'pct', dis: !(p.bassMonoHz > 0) })])
    + '<div style="display:flex;flex-direction:column;gap:2px">' + fader(s, { p: 'stereo.widthHz', label: 'WIDTH ABOVE', min: 50, max: 1000, st: 10, k: 'hz' }) + fader(s, { p: 'stereo.balanceDb', label: 'BALANCE', min: -6, max: 6, st: 0.5, k: 'db' }) + fader(s, { p: 'stereo.midDb', label: 'MID', min: -6, max: 6, st: 0.5, k: 'db' }) + fader(s, { p: 'stereo.sideDb', label: 'SIDE', min: -6, max: 6, st: 0.5, k: 'db' }) + '</div>');
}
// 08 Tonal
function uTone(c) {
  const s = c.s, t = s.tone, rows = [['AIR', 'air'], ['PRESENCE', 'presence'], ['CLARITY', 'clarity'], ['LOW', 'low']];
  const gainAt = (f) => { const x = lg(f); return t.airDb * sig((x - lg(t.airHz)) / 0.05) + t.lowDb * (1 - sig((x - lg(t.lowHz)) / 0.05)) + t.presenceDb * Math.exp(-Math.pow(x - lg(t.presenceHz), 2) / (2 * 0.06 * 0.06)) + t.clarityDb * Math.exp(-Math.pow(x - lg(t.clarityHz), 2) / (2 * 0.06 * 0.06)); };
  const pts = []; for (let i = 0; i <= 64; i++) { const fr = i / 64; pts.push([PX(fr), cl(46 - gainAt(20 * Math.pow(1000, fr)) * 6, 8, 84)]); }
  const shapes = L(14, 46, 268, 46, { c: 'line' }) + L(14, 27, 268, 27, { dash: '2 4' }) + L(14, 65, 268, 65, { dash: '2 4' }) + P(poly(pts), { sw: 2 });
  const texts = T(18, 24, '+3', { c: 'muted' }) + T(18, 74, '-3', { c: 'muted' }) + [[100, '100'], [1000, '1k'], [10000, '10k']].map(([f, l]) => T(PX(lg(f)), 96, l, { a: 'mid', c: 'muted' })).join('');
  return unit(c, 8, 'tone', 'Tonal enhancement', 'LA-08 TONE', lcd('Kurva tonal enhancement', shapes, texts) + '<div style="display:flex;flex-direction:column;gap:2px">' + rows.map(([nm, id]) => fader(s, { p: 'tone.' + id + 'Db', label: nm + ' / ' + hzF(t[id + 'Hz']), min: -6, max: 6, st: 0.5, k: 'db' })).join('') + '</div>');
}
// 09 Clipper
function uClip(c) {
  const s = c.s, p = s.clip, thr = p.thrDb, kn = p.kneeDb, hard = p.mode === 'hard', outF = (x) => (hard ? Math.min(x, thr) : (x <= thr - kn ? x : thr - kn + kn * Math.tanh((x - (thr - kn)) / Math.max(kn, 0.1))));
  const pts = []; for (let x = -12; x <= 6.001; x += 0.5) pts.push([PX((x + 12) / 18), PY(cl((outF(x) + 12) / 18, 0, 1))]);
  const tx = PX((thr + 12) / 18);
  const shapes = axes() + L(14, 84, 268, 8, { dash: '2 3' }) + L(tx, 8, tx, 84, { c: 'accent', dash: '2 3' }) + P(poly(pts), { sw: 2 });
  const texts = T(20, 17, 'OUT dBFS', { c: 'muted' }) + T(268, 96, 'IN dBFS', { a: 'end', c: 'muted' }) + T(tx - 4, 20, 'THR ' + dbF(thr).replace(' dB', ''), { a: 'end', c: 'accent' });
  return unit(c, 9, 'clip', 'Clipper', 'LA-09 CLIPPER', lcd('Perkiraan kurva transfer clipper', shapes, texts)
    + knobsGrid([knob(s, { p: 'clip.thrDb', label: 'THRESH', min: -6, max: 6, st: 0.5, k: 'db' }), knob(s, { p: 'clip.kneeDb', label: 'KNEE', min: 0, max: 6, st: 0.5, k: 'dbn', dis: hard, title: hard ? 'Mode HARD tidak memakai knee' : '' })])
    + group('MODE', opts(s, 'clip.mode', [['SOFT', 'soft'], ['HARD', 'hard']])) + group('OVERSAMPLE', opts(s, 'clip.os', [['2x', 2], ['4x', 4], ['8x', 8]])));
}
// 10 Limiter
function uLim(c) {
  const s = c.s, p = s.lim, ceil = p.ceilingDb, r = rep(c, 'lim'), gs = c.report && c.report.grSeries ? c.report.grSeries : null, pts = [];
  const N = 40; for (let i = 0; i <= N; i++) { let v = 0; if (gs && gs.length) { const a = Math.floor(i / (N + 1) * gs.length), b = Math.max(a + 1, Math.floor((i + 1) / (N + 1) * gs.length)); for (let j = a; j < b && j < gs.length; j++) if (gs[j] < v) v = gs[j]; } pts.push([PX(i / N), 8 + cl(-v / 6, 0, 1) * 72]); }
  const gr = r && isFinite(r.maxGrDb) ? Math.abs(r.maxGrDb) : NaN;
  const shapes = L(14, 8, 268, 8, { c: 'line' }) + L(14, 44, 268, 44, { dash: '2 4' }) + L(14, 80, 268, 80, { dash: '2 4' }) + (gs ? P(poly(pts) + 'L268 8L14 8Z', { fill: 'accent', fo: 0.22, c: 'none', sw: 0 }) + P(poly(pts), { sw: 1.8 }) : '');
  const texts = T(14, 96, gs ? 'GR 0-6 dB' : 'GR: render dulu', { c: 'muted' }) + T(268, 96, 'CEILING ' + dbF(ceil) + 'TP', { a: 'end', c: 'accent', w: 600 });
  return unit(c, 10, 'lim', 'True-peak limiter', 'LA-10 LIMITER', lcd('Riwayat gain reduction limiter dari render terakhir', shapes, texts)
    + group('STYLE', opts(s, 'lim.style', [['BALANCED', 'balanced'], ['TRANSPARENT', 'transparent'], ['PUNCHY', 'punchy']]))
    + knobsGrid([knob(s, { p: 'lim.ceilingDb', label: 'CEILING', min: -3, max: 0, st: 0.1, k: 'db' }), knob(s, { p: 'lim.lookaheadMs', label: 'LOOKAHEAD', min: 1, max: 10, st: 0.5, k: 'ms' }), knob(s, { p: 'lim.releaseMs', label: 'RELEASE', min: 10, max: 500, st: 10, k: 'ms' }),
      knob(s, { p: 'lim.driveDb', label: 'DRIVE', min: 0, max: 12, st: 0.5, k: 'db', dis: !s.loud.bypass, title: 'Dipakai hanya saat Loudness management di-bypass' }), knob(s, { p: 'lim.trimDb', label: 'TRIM', min: -6, max: 0, st: 0.5, k: 'db' })])
    + '<div class=tgs>' + tog(s, 'lim.autoRelease', 'AUTO RELEASE') + tog(s, 'lim.tpDetect', 'TP DETECT') + '</div>'
    + ledRow('GR', isFinite(gr) ? Math.round(cl(gr / 6, 0, 1) * 12) : 0, isFinite(gr) ? '-' + gr.toFixed(1) + ' dB' : '—', 8));
}
// 11 Loudness
function uLoud(c) {
  const s = c.s, p = s.loud, L0 = c.report && c.report.loudness ? c.report.loudness : null, tg = p.targetLufs, mx = p.maxLimitLu, bx = (v) => PX(cl((v + 24) / 18, 0, 1)), lim = L0 ? L0.limitingLu : NaN;
  const shapes = R(14, 36, 254, 10, 'soft', 0.6) + R(14, 36, bx(tg) - 14, 10, 'text') + R(14, 66, 254, 10, 'soft', 0.6) + (isFinite(lim) ? R(14, 66, 254 * cl(lim / 8, 0, 1), 10, 'accent') : '') + L(bx(tg), 30, bx(tg), 52, { c: 'accent', sw: 2 }) + L(14 + 254 * cl(mx / 8, 0, 1), 60, 14 + 254 * cl(mx / 8, 0, 1), 82, { c: 'accent', dash: '2 3' });
  const texts = T(14, 22, tg.toFixed(1) + ' LUFS', { size: 15, w: 600 }) + T(268, 22, 'GAIN ' + (L0 ? dbF(L0.gainDb) : '—'), { a: 'end', size: 12, w: 600, c: 'accent' }) + T(14, 62, 'LIMITING ' + (isFinite(lim) ? lim.toFixed(1) : '—') + ' LU', { c: 'muted' }) + T(268, 62, 'MAX ' + mx.toFixed(1), { a: 'end', c: 'muted' }) + T(14, 96, '-24', { c: 'muted' }) + T(268, 96, '-6 LUFS', { a: 'end', c: 'muted' });
  return unit(c, 11, 'loud', 'Loudness management', 'LA-11 LOUDNESS', lcd('Target loudness dan limiting dari render terakhir', shapes, texts)
    + knobsGrid([knob(s, { p: 'loud.targetLufs', label: 'TARGET', min: -24, max: -6, st: 0.5, k: 'lufs' }), knob(s, { p: 'loud.maxLimitLu', label: 'MAX LIMIT', min: 0, max: 8, st: 0.5, k: 'lu', dis: !p.preserveDynamics, title: 'Dipakai saat PRESERVE DYNAMICS aktif' })])
    + '<div class=tgs>' + tog(s, 'loud.preserveDynamics', 'PRESERVE DYNAMICS') + '</div>');
}
// 12 Analysis & QC (hanya baca)
function uAna(c) {
  const A = c.man, f = (v, d, u) => (A && isFinite(v) ? v.toFixed(d) + (u || '') : '—'), cell = (x, y, lab, val, col) => T(x, y, lab, { c: 'muted' }) + T(x, y + 19, val, { size: 15, w: 600, c: col || 'text' });
  const texts = cell(14, 18, 'LUFS-I', f(A && A.loudness.integrated, 1)) + cell(154, 18, 'LRA', f(A && A.loudness.lra, 1, ' LU')) + cell(14, 66, 'TRUE PEAK', f(A && A.truePeak.dbtp, 1, ' dBTP')) + cell(154, 66, 'CORRELATION', f(A && A.stereo ? A.stereo.correlation : NaN, 2), 'accent');
  const vent = '<svg class=vent viewBox="0 0 288 22" aria-hidden=true>' + Array.from({ length: 18 }, (_, i) => '<rect x=' + (i * 16 + 3) + ' y=2 width=8 height=18 rx=4 />').join('') + '</svg>';
  return unit(c, 12, null, 'Analysis & QC', 'LA-12 ANALYSIS', lcd('Hasil analisis master terakhir', L(141, 8, 141, 90, { c: 'line' }) + L(14, 50, 268, 50, { c: 'line' }), texts) + vent, { noSw: true });
}
// seluruh rantai. s = settings, ctx = { ui:{open,eqSel,mbSel,satSel}, an, man, report, fs }
export function renderRack(s, ctx) {
  const c = { s, ui: Object.assign({ open: {}, eqSel: 0, mbSel: 0, satSel: 0 }, ctx.ui || {}), an: ctx.an || null, man: ctx.man || null, report: ctx.report || null, fs: ctx.fs || 44100 };
  return [uPre, uEq, uDyn, uComp, uMb, uSat, uStereo, uTone, uClip, uLim, uLoud, uAna].map((f) => f(c)).join('')
    + '<span class=small style="padding:0 2px">Adaptive corrections (EQ bands marked A and the adjusted values above) are already part of this chain. To change them, use the Adaptive correction checkbox, then Reset to preset.</span>';
}
