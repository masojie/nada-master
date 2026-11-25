// app.js - UI thread (Lintang Audio): upload/decode, genre list, A/B player, meters, visualisation, rack-style advanced chain editor
import { GENRES, CATEGORIES, VOICINGS, MODES, LOUDNESS_TARGETS } from '../engine/settings.js';
import { detectFormat, mp3Info } from '../engine/codecs.js';
import { escHtml, exportFileName, clampSetting } from './ui-util.js';
import { genreListHtml } from './genre-view.js';
import { selAbout, selOptionDesc } from './sel-info.js';
import { parseTags } from './meta.js';
import { MODE_INFO, METRIC_INFO } from './explain.js';
import { renderRack, getPath, FMT, newBand } from './rack.js';
import { buildParams } from '../preview/preview-params.js';
import { previewOpts } from '../preview/preview-opts.js';
const $ = (id) => document.getElementById(id);
// S.rendered: settings of the last render. Export and its file name use these, never the latest (not yet rendered) plan.
const S = { genre: GENRES[0].id, openGenre: null, ui: { open: {}, eqSel: 0, mbSel: 0, satSel: 0 }, an: null, man: null, info: null, report: null, qc: null, settings: null, rendered: null, edited: false, bufA: null, bufB: null, ab: 'A', playing: false, busy: false, fileName: 'track', exportUrl: null };
const VN = { balanced: 'Balanced', vocalClarity: 'Vocal Clarity', warmAnalog: 'Warm Analog', punchy: 'Punchy', bright: 'Bright', smooth: 'Smooth' };
const esc = escHtml;
const f1 = (v, d = 1) => (v == null || !isFinite(v) ? '—' : (+v).toFixed(d));
const sgn = (v, d = 1) => (v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + (+v).toFixed(d));
const fmtTime = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60); return m + ':' + (t - m * 60).toFixed(1).padStart(4, '0'); };
const DPR = () => window.devicePixelRatio || 1;
// ---------- theme (krem / gelap) ----------
const root = document.documentElement;
const cvc = Object.create(null);
const cssv = (n) => { const k = (root.getAttribute('data-theme') || '') + '|' + n; return cvc[k] || (cvc[k] = getComputedStyle(root).getPropertyValue('--' + n).trim()); };
function setTheme(t, save) { root.setAttribute('data-theme', t); $('themeTxt').textContent = 'TEMA: ' + (t === 'dark' ? 'GELAP' : 'TERANG'); if (save) { try { localStorage.setItem('lintang-theme', t); } catch (e) {} } if (S.an !== undefined) { drawWave(); drawSpec(); kick(); } }
$('themeBtn').onclick = () => setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
// ---------- engine worker ----------
const wsrc = $('worker-src');
const worker = wsrc ? new Worker(URL.createObjectURL(new Blob([wsrc.textContent], { type: 'text/javascript' }))) : new Worker('engine-worker.js');
const H = {};
worker.onmessage = (e) => { const h = H[e.data.type]; if (h) h(e.data); };
worker.onerror = (e) => fail('Engine error: ' + (e.message || 'worker failed'));
function status(t, c) { $('statusTxt').textContent = t; $('status').className = 'status has ' + (c || ''); }
// CSP ketat: pelanggaran SKRIP/WORKER milik aplikasi sendiri tampil jelas di status bar (bukan gagal diam-diam).
// Yang berasal dari luar (toolbar komentar Vercel di Preview, ekstensi browser) atau manifest-src saat Preview diproteksi login hanya dicatat di konsol.
document.addEventListener('securitypolicyviolation', (e) => {
  console.warn('CSP memblokir', e.violatedDirective, e.blockedURI);
  const own = !/^https?:/i.test(e.blockedURI || '') || e.blockedURI.startsWith(location.origin);
  if (own && /^(script-src|worker-src)/.test(e.violatedDirective)) status('Diblokir kebijakan keamanan (CSP): ' + e.violatedDirective + (e.blockedURI ? ' · ' + e.blockedURI : ''), 'err');
});
function fail(msg) { busy(false); status(msg, 'err'); $('progTxt').textContent = msg; }
function busy(b) { S.busy = b; if (!b) { S.mastering = false; if (typeof updateMasterBtn === 'function') updateMasterBtn(); } $('btnMaster').disabled = b || !S.an; $('btnExport').disabled = b || !S.bufB; document.body.classList.toggle('busy', b); }
let pgT = 0, pgV = 0, pgCap = 0;
function progress(p, t) { pgV = p; pgCap = Math.min(0.97, p + 0.1); $('progBar').style.width = (p * 100).toFixed(1) + '%'; $('progTxt').textContent = t ? t + ' ' + Math.round(p * 100) + '%' : ''; if (S.busy && S.mastering) $('btnMaster').textContent = 'MASTERING… ' + Math.round(p * 100) + '%'; if (!pgT && p > 0 && p < 1) pgT = setInterval(() => { if (!S.busy || pgV >= pgCap) { if (!S.busy) { clearInterval(pgT); pgT = 0; } return; } pgV += (pgCap - pgV) * 0.08; $('progBar').style.width = (pgV * 100).toFixed(1) + '%'; }, 120); }
H.error = (m) => fail('Error: ' + m.message);
// ---------- preset controls ----------
CATEGORIES.forEach((c, i) => $('cat').add(new Option(c, i)));
const genreOf = (id) => GENRES.find((x) => x.id === id);
function fillGenres() { const ci = +$('cat').value, list = GENRES.filter((g) => g.categoryIndex === ci); if (!list.some((g) => g.id === S.genre)) S.genre = list[0].id; S.openGenre = null; showGenre(); }
function showGenre() { const ci = +$('cat').value, list = GENRES.filter((g) => g.categoryIndex === ci); $('glist').innerHTML = genreListHtml(list, S.genre, S.openGenre); $('glist').classList.toggle('open', !!S.openGenre); }
$('glist').addEventListener('click', (e) => {
  const tg = e.target.closest('[data-toggle]'), use = e.target.closest('[data-use]');
  if (tg) { S.openGenre = S.openGenre === tg.dataset.toggle ? null : tg.dataset.toggle; showGenre(); }
  if (use && !use.disabled) { S.genre = use.dataset.use; showGenre(); onPreset(); }
});
Object.keys(VOICINGS).forEach((k) => $('voicing').add(new Option(VN[k] || k, k)));
LOUDNESS_TARGETS.forEach((t) => $('loud').add(new Option(t.name, t.id)));
let mode = 'modern';
MODES.forEach((m) => { const b = document.createElement('button'); b.className = 'mbtn'; b.textContent = m.name; b.title = m.desc; b.setAttribute('aria-pressed', m.id === mode);
  b.onclick = () => { mode = m.id; [...$('modes').children].forEach((x) => x.setAttribute('aria-pressed', x === b)); onPreset(); }; $('modes').appendChild(b); });
function opts() { const c = clampSetting('targetLufs', +$('custom').value); return { genre: S.genre, mode, voicing: $('voicing').value, loudness: $('loud').value, customLufs: c == null ? -12 : c, ceilingDb: +$('ceil').value, adaptive: $('adaptive').checked }; }
function expl(id, title, plain, fx) { $(id).innerHTML = '<b>' + escHtml(title) + '</b> ' + escHtml(plain) + '<details><summary>Detail pengaturan</summary><ul>' + fx.map((x) => '<li>' + escHtml(x) + '</li>').join('') + '</ul></details>'; }
function renderModeExpl() { const m = MODE_INFO[mode], mn = MODES.find((x) => x.id === mode); if (m && mn) expl('modeExpl', mn.name + ':', m.plain, m.fx); }
function onPreset() { renderModeExpl(); $('customWrap').classList.toggle('hide', $('loud').value !== 'custom'); S.edited = false; updateMasterBtn(); if (S.an) worker.postMessage({ type: 'plan', opts: opts() }); }
$('cat').onchange = () => { fillGenres(); onPreset(); };
['voicing', 'loud', 'ceil', 'adaptive', 'custom'].forEach((id) => { $(id).onchange = onPreset; });
H.plan = (m) => { if (!S.edited) { S.settings = m.settings; renderChain(); } renderProblems(m.problems); renderActions(m.actions); noteStale(); };
// the plan may change after a render: export keeps using the rendered settings and the user is told how to apply the new ones
function noteStale() { if (S.bufB && S.rendered && S.settings && !S.busy && JSON.stringify(S.settings) !== JSON.stringify(S.rendered)) status('Settings changed since the last render: export uses the last render. Press RE-MASTER to apply them.', 'warn'); }
$('uiMode').onclick = (e) => { const t = e.target.closest('[data-v]'); if (!t) return; [...$('uiMode').children].forEach((b) => { b.classList.toggle('on', b === t); b.setAttribute('aria-pressed', b === t); }); $('advCard').classList.toggle('hide', t.dataset.v !== 'advanced'); $('pvRow').classList.toggle('hide', t.dataset.v !== 'advanced'); };
// ---------- file loading ----------
$('file').onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; };
const drop = $('drop');
['dragover', 'dragenter'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('hot'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('hot'); }));
drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
async function loadFile(f) {
  try {
    stopPlay(); busy(true); const dot = f.name.lastIndexOf('.'); S.fileName = dot > 0 ? f.name.slice(0, dot) : f.name;
    status('Decoding ' + f.name + ' …'); progress(0.05, 'Decoding…');
    const buf = await f.arrayBuffer(), u8 = new Uint8Array(buf), kind = detectFormat(u8); S.tags = parseTags(u8); S.fileType = f.type || ''; S.fileMod = f.lastModified || 0;
    if (kind === 'wav' || kind === 'aiff' || kind === 'flac') { worker.postMessage({ type: 'decode', buffer: buf, name: f.name }, [buf]); return; }
    const mi = kind === 'mp3' ? mp3Info(u8) : null, OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OAC(2, 1, mi ? mi.sampleRate : 48000), ab = await ctx.decodeAudioData(buf.slice(0));
    const chans = []; for (let c = 0; c < Math.min(2, ab.numberOfChannels); c++) chans.push(new Float32Array(ab.getChannelData(c)));
    worker.postMessage({ type: 'pcm', chans, fs: ab.sampleRate, info: { name: f.name, size: f.size, codec: kind === 'mp3' ? 'MP3 (decoded at native rate)' : 'Browser-decoded', bitDepth: kind === 'mp3' ? 'lossy' : 'float' } }, chans.map((c) => c.buffer));
  } catch (err) { fail('Could not decode file: ' + err.message); }
}
function makeBuffer(pcm, fs) { const b = new AudioBuffer({ length: pcm[0].length, numberOfChannels: pcm.length, sampleRate: fs }); pcm.forEach((c, i) => b.copyToChannel(c, i)); return b; }
H.loaded = (m) => {
  const i = m.info; S.an = m.analysis; S.info = i; S.man = null; S.report = null; S.qc = null; S.bufB = null; S.rendered = null; S.edited = false; revokeExport();
  S.bufA = makeBuffer(m.pcm, i.fs); off = 0; PV.once = false; setAB('A');
  { const an = S.an, L = an.loudness || {}, f1 = (v, u) => (isFinite(v) ? v.toFixed(1) + u : '-'), kb = (i.size || 0) / 1024, rows = [['Nama file', i.name], ['Ukuran', kb >= 1024 ? (kb / 1024).toFixed(2) + ' MB' : kb.toFixed(0) + ' KB'], ['Format', i.codec], ['Bit depth', typeof i.bitDepth === 'number' ? i.bitDepth + '-bit' : i.bitDepth], ['Sample rate', i.fs + ' Hz'], ['Channel', i.channels === 1 ? 'mono' : 'stereo'], ['Durasi', fmtTime(i.duration)], ['Jumlah sampel', (i.frames || 0).toLocaleString('en-US')], ['Bitrate rata-rata', i.size && i.duration ? Math.round(i.size * 8 / i.duration / 1000) + ' kbps' : '-'], ['Loudness (LUFS)', f1(L.integrated, ' LUFS')], ['Loudness range', f1(L.lra, ' LU')], ['True peak', f1(an.truePeak && an.truePeak.dbtp, ' dBTP')], ['Sample peak', f1(an.samplePeakDb, ' dBFS')], ['RMS', f1(an.rmsDb, ' dBFS')], ['Crest factor', f1(an.crestDb, ' dB')], ['PLR', f1(an.plr, ' dB')], ['Clipping', (an.clipRuns || 0) + ' run']];
    if (an.stereo) rows.push(['Korelasi stereo', an.stereo.correlation.toFixed(2)], ['Lebar stereo', an.stereo.widthPct.toFixed(0) + '%']);
    if (S.fileMod) rows.push(['Terakhir diubah', new Date(S.fileMod).toLocaleString('id-ID')]);
    (S.tags || []).forEach((t) => rows.push(['Tag · ' + t[0], t[1]])); if (i.note) rows.push(['Catatan', i.note]);
    $('fileInfo').innerHTML = '<div class=meta>' + rows.map((r) => '<div class=mr><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>').join('') + '</div>'; }
  $('btnPlay').disabled = false; $('btnStop').disabled = false; $('abB').disabled = true; busy(false); updateMasterBtn();
  status('Analysed in ' + (i.ms / 1000).toFixed(1) + ' s - choose a genre preset, then press MASTER', 'ok'); progress(0, '');
  $('qc').textContent = 'Master a track to run QC.'; renderCompare(); drawWave(); drawSpec(); updateDelta(); kick();
  worker.postMessage({ type: 'plan', opts: opts() });
};
// ---------- master & export ----------
const STAGES = ['pre', 'eq', 'dyneq', 'comp', 'mb', 'sat', 'stereo', 'tone', 'loud', 'analysis'];
$('btnMaster').onclick = () => { if (!S.an || S.busy) return; S.mastering = true; busy(true); progress(0.03, 'Starting…'); $('editedTxt').textContent = ''; const msg = { type: 'master', opts: opts() }; if (S.edited) msg.settings = S.settings; worker.postMessage(msg); };
H.progress = (m) => { const i = STAGES.indexOf(m.id); progress(i < 0 ? 0.05 : (i + 1) / (STAGES.length + 1), m.label + '…'); status(m.label + '…'); };
function updateMasterBtn() { if (!S.edited) $('editedTxt').textContent = ''; $('btnMaster').textContent = S.edited ? 'RE-MASTER (edited chain)' : (S.bufB ? 'RE-MASTER' : 'MASTER'); }
H.mastered = (m) => {
  S.man = m.analysis; S.report = m.report; S.qc = m.qc; S.settings = m.settings; S.rendered = JSON.parse(JSON.stringify(m.settings)); S.edited = m.edited; S.bufB = makeBuffer(m.pcm, m.analysis.fs);
  busy(false); $('abB').disabled = false; progress(1, 'Rendered in ' + (m.ms / 1000).toFixed(1) + ' s');
  const L = m.report.loudness || {};
  status('Mastered: ' + f1(m.analysis.loudness.integrated) + ' LUFS · ' + f1(m.analysis.truePeak.dbtp, 2) + ' dBTP' + (L.capped ? ' · loudness capped to protect dynamics' : '') + ' - compare A/B, then export', 'ok');
  renderActions(m.actions); renderProblems(m.problems); renderQC(); renderCompare(); renderChain(); drawWave(); drawSpec(); updateMasterBtn(); setAB('B');
  if (S.playing) startPlay(pos()); kick();
};
$('btnExport').onclick = () => { if (!S.bufB || !S.rendered || S.busy) return; const fb = $('fmt').value.split(':'); busy(true); progress(0.5, 'Encoding and verifying…');
  worker.postMessage({ type: 'export', opts: { format: fb[0], bits: +fb[1], sampleRate: +$('sr').value, dither: $('dither').value, ceilingDb: S.rendered.lim.ceilingDb } }); };
// export blobs can be tens of MB: release the previous one (new export, new file, page hide)
function revokeExport() { if (S.exportUrl) { URL.revokeObjectURL(S.exportUrl); S.exportUrl = null; } $('exportOut').textContent = ''; }
window.addEventListener('pagehide', () => { if (S.exportUrl) URL.revokeObjectURL(S.exportUrl); });
H.exported = (m) => {
  busy(false); progress(1, 'Export ready (' + (m.ms / 1000).toFixed(1) + ' s)'); const ext = m.opts.format === 'flac' ? 'flac' : 'wav';
  const name = exportFileName(S.fileName, (S.rendered && S.rendered.meta) || {}, m.opts.bits, m.fs, ext);
  revokeExport(); const url = (S.exportUrl = URL.createObjectURL(new Blob([m.bytes], { type: ext === 'flac' ? 'audio/flac' : 'audio/wav' })));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  // built with DOM APIs: the name comes from the user's file and must never be parsed as HTML
  const out = $('exportOut'), link = document.createElement('a'); link.className = 'dl'; link.href = url; link.download = name; link.textContent = '⬇ ' + name; out.appendChild(link);
  out.appendChild(document.createElement('br')); out.appendChild(document.createTextNode((m.bytes.byteLength / 1048576).toFixed(1) + ' MB · dither: ' + m.dither));
  for (const c of m.checks) { const d = document.createElement('div'); d.className = c.ok ? 'pass' : 'fail'; d.textContent = (c.ok ? '✔ ' : '✖ ') + c.title + ': ' + c.value; out.appendChild(d); }
  status(m.ok ? 'Export verified - file downloaded' : 'Export verification reported issues', m.ok ? 'ok' : 'err');
};
// ---------- A/B player ----------
let ac = null, gA, gB, ana, anL, anR, srcA = null, srcB = null, t0 = 0, off = 0, specBuf = null;
function ensureAC() {
  if (ac) return; ac = new (window.AudioContext || window.webkitAudioContext)(); gA = ac.createGain(); gB = ac.createGain(); const mix = ac.createGain(); gA.connect(mix); gB.connect(mix);
  ana = ac.createAnalyser(); ana.fftSize = 8192; ana.smoothingTimeConstant = 0.78; mix.connect(ana); ana.connect(ac.destination);
  const sp = ac.createChannelSplitter(2); mix.connect(sp); anL = ac.createAnalyser(); anR = ac.createAnalyser(); anL.fftSize = 2048; anR.fftSize = 2048; sp.connect(anL, 0); sp.connect(anR, 1);
}
function setPlayIcon(on) { pvUi(); $('playIco').setAttribute('d', on ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M7 4l13 8-13 8z'); $('btnPlay').setAttribute('aria-label', on ? 'Pause' : 'Play'); }
const dur = () => (S.bufA ? S.bufA.duration : 0);
function pos() { if (!S.playing || !ac) return off; let p = ac.currentTime - t0; if ($('loop').checked && dur() > 0) p = p % dur(); return Math.max(0, Math.min(p, dur())); }
function stopSources() { for (const s of [srcA, srcB]) if (s) { s.onended = null; try { s.stop(); } catch (e) {} s.disconnect(); } srcA = null; srcB = null; }
function startPlay(at) {
  if (!S.bufA) return; ensureAC(); if (ac.state === 'suspended') ac.resume(); stopSources();
  const o = Math.min(at == null ? off : at, Math.max(0, dur() - 0.01)), when = ac.currentTime + 0.03, lp = $('loop').checked;
  srcA = ac.createBufferSource(); srcA.buffer = S.bufA; srcA.loop = lp; srcA.connect(gA); pvAttach();
  if (S.bufB) { srcB = ac.createBufferSource(); srcB.buffer = S.bufB; srcB.loop = lp; srcB.connect(gB); }
  srcA.start(when, o); if (srcB) srcB.start(when, o); t0 = when - o; S.playing = true; applyAB(true); setPlayIcon(true);
  srcA.onended = () => { if (S.playing && !$('loop').checked) { S.playing = false; off = 0; stopSources(); setPlayIcon(false); drawSpec(); kick(); } };
  kick();
}
function stopPlay() { if (S.playing) off = pos(); S.playing = false; stopSources(); setPlayIcon(false); drawSpec(); kick(); }
// ---------- live preview (jalur cepat: AudioWorklet, perkiraan; MASTER tetap hasil akurat) ----------
// PV.live = saklar menetap (tersimpan). PV.once = tombol PREVIEW (sekali pakai: sampai ditekan lagi atau lagu diganti).
const PV = { node: null, loading: null, live: false, once: false, cpu: 0, hot: 0, glitch: 0, err: '', est: [], first: true };
try { PV.live = localStorage.getItem('lintang-preview-live') === '1'; } catch (e) {}
const pvWant = () => !!(S.bufA && S.settings && S.ab === 'A' && (PV.live || PV.once));
function pvSave() { try { localStorage.setItem('lintang-preview-live', PV.live ? '1' : '0'); } catch (e) {} }
function pvEnsure() {
  if (PV.node) return Promise.resolve(PV.node); if (PV.loading) return PV.loading;
  if (!ac || !ac.audioWorklet) { PV.err = 'Preview needs AudioWorklet (not available here)'; pvUi(); return Promise.resolve(null); }
  PV.loading = ac.audioWorklet.addModule('preview-worklet.js').then(() => {
    const n = new AudioWorkletNode(ac, 'lintang-preview', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit', outputChannelCount: [2] });
    n.onprocessorerror = () => pvOff('Preview stopped: processor error'); n.port.onmessage = pvMeter; n.connect(gA); PV.node = n; PV.first = true; PV.err = ''; return n;
  }).catch((e) => { PV.err = 'Preview unavailable: ' + ((e && e.message) || e); return null; }).finally(() => { PV.loading = null; pvRoute(); pvUi(); });
  return PV.loading;
}
function pvSend() {
  if (!PV.node || !S.settings || !ac) return;
  try { const o = previewOpts({ settings: S.settings, an: S.an, report: S.report, rendered: S.rendered }); PV.est = o.estimated; PV.node.port.postMessage({ params: buildParams(S.settings, ac.sampleRate, o).params, settle: PV.first }); PV.first = false; }
  catch (e) { PV.err = 'Preview parameters failed: ' + ((e && e.message) || e); pvUi(); }
}
let pvT = 0;
function pvKick() { if (!PV.node || pvT) return; pvT = requestAnimationFrame(() => { pvT = 0; if (pvWant()) pvSend(); }); }
function pvRoute() { // srcA -> worklet (preview) or straight to gA (original)
  if (!srcA || !gA) { pvUi(); return; } const on = !!(PV.node && pvWant()); try { srcA.disconnect(); } catch (e) {} srcA.connect(on ? PV.node : gA);
  if (on) { PV.first = true; pvSend(); } pvUi();
}
function pvAttach() { if (!pvWant()) return; if (PV.node) pvRoute(); else pvEnsure(); }
function pvOff(msg) { PV.live = false; PV.once = false; pvSave(); pvRoute(); if (msg) status(msg, 'warn'); pvUi(); }
function pvMeter(e) {
  const d = e.data; if (!d || d.cpu == null) return; PV.cpu = PV.cpu ? PV.cpu * 0.7 + d.cpu * 0.3 : d.cpu; PV.glitch = d.glitch; PV.hot = PV.cpu > 0.8 ? PV.hot + 1 : 0;
  if (PV.hot >= 12) { pvOff('Preview turned off: CPU load too high (use MASTER for the accurate result)'); return; } pvUi();
}
function pvUi() {
  const row = $('pvRow'); if (!row) return; const want = pvWant(), act = want && !!PV.node && S.playing;
  $('pvLive').checked = PV.live; $('pvBtn').disabled = !S.bufA; $('pvBtn').classList.toggle('on', want); $('pvBtn').setAttribute('aria-pressed', want); $('pvBtn').textContent = want ? 'PREVIEW ON' : 'PREVIEW';
  $('chain').classList.toggle('pv-on', want); $('abA').textContent = act ? 'A · PREVIEW' : 'A · ORIGINAL';
  $('pvStat').textContent = PV.err ? PV.err : act ? 'PREVIEW (approximate) · CPU ' + Math.round(PV.cpu * 100) + '% · dropouts ' + PV.glitch + (PV.est.length ? ' · estimated: ' + PV.est.join(', ') : ' · gain/threshold from last MASTER') : want ? 'Preview on - press play' : '';
}
$('pvLive').onchange = () => { PV.live = $('pvLive').checked; pvSave(); if (PV.live && S.bufA && S.ab !== 'A') setAB('A'); if (srcA) { if (PV.node) pvRoute(); else if (pvWant()) pvEnsure(); } pvUi(); };
$('pvBtn').onclick = () => {
  if (!S.bufA) return;
  if (pvWant()) { PV.once = false; PV.live = false; pvSave(); pvRoute(); pvUi(); return; }
  PV.once = true; PV.err = ''; if (S.ab !== 'A') setAB('A'); if (S.playing) { if (PV.node) pvRoute(); else pvEnsure(); } else startPlay(); pvUi();
};
function matchGains() { let a = 1, b = 1; if ($('lmatch').checked && S.man && S.an) { const d = S.man.loudness.integrated - S.an.loudness.integrated; if (isFinite(d)) { if (d > 0) b = Math.pow(10, -d / 20); else a = Math.pow(10, d / 20); } } return [a, b]; }
function applyAB(instant) { if (!ac) return; const g = matchGains(), t = ac.currentTime, tc = instant ? 0.001 : 0.012; gA.gain.setTargetAtTime(S.ab === 'A' ? g[0] : 0, t, tc); gB.gain.setTargetAtTime(S.ab === 'B' && S.bufB ? g[1] : 0, t, tc); }
function setAB(v) { S.ab = v; pvRoute(); $('abA').classList.toggle('on', v === 'A'); $('abB').classList.toggle('on', v === 'B'); $('abA').setAttribute('aria-pressed', v === 'A'); $('abB').setAttribute('aria-pressed', v === 'B'); if (S.an) drawWave(); applyAB(); updateDelta(); kick(); }
function updateDelta() {
  if (!S.man || !S.an) { $('delta').textContent = ''; return; }
  const dI = S.man.loudness.integrated - S.an.loudness.integrated, dT = S.man.truePeak.dbtp - S.an.truePeak.dbtp, g = matchGains();
  $('delta').innerHTML = 'Δ Loudness <b>' + sgn(dI) + ' LU</b> · Δ True peak <b>' + sgn(dT, 2) + ' dB</b> · Δ LRA <b>' + sgn(S.man.loudness.lra - S.an.loudness.lra) + ' LU</b> - ' + ($('lmatch').checked ? 'loudness-matched: ' + (g[1] < 1 ? 'master' : 'original') + ' turned down ' + f1(-20 * Math.log10(Math.min(g[0], g[1]))) + ' dB for a fair comparison' : 'not matched (the louder version will seem better)');
}
$('btnPlay').onclick = () => (S.playing ? stopPlay() : startPlay());
$('btnStop').onclick = () => { stopPlay(); off = 0; kick(); };
$('abA').onclick = () => setAB('A');
$('abB').onclick = () => { if (S.bufB) setAB('B'); };
$('lmatch').onchange = () => { applyAB(); updateDelta(); kick(); };
$('loop').onchange = () => { if (S.playing) startPlay(pos()); };
document.addEventListener('keydown', (e) => { const tg = e.target.tagName; if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return; if (e.code === 'Space' && S.bufA) { e.preventDefault(); $('btnPlay').onclick(); } if (e.key === 'a' || e.key === 'A') setAB('A'); if ((e.key === 'b' || e.key === 'B') && S.bufB) setAB('B'); });
$('wave').addEventListener('click', (e) => { if (!S.bufA) return; const r = e.target.getBoundingClientRect(), p = Math.max(0, Math.min(1, (e.clientX - r.left - WPAD) / Math.max(1, r.width - 2 * WPAD))) * dur(); if (S.playing) startPlay(p); else { off = p; kick(); } });
// ---------- meters ----------
const METERS = [['m', 'Momentary', 'LUFS', -40, 0], ['s', 'Short-term', 'LUFS', -40, 0], ['i', 'Integrated', 'LUFS', -40, 0], ['tp', 'True peak', 'dBTP', -30, 3], ['lra', 'Loudness range', 'LU', 0, 20], ['plr', 'Peak-to-loudness', 'dB', 0, 24], ['corr', 'Phase correlation', '', -1, 1], ['gr', 'Limiter GR', 'dB', 0, 12]];
$('meters').innerHTML = METERS.map((d) => '<div class=mtr id=mt_' + d[0] + '><span class=lbl>' + d[1] + '</span><div class=mv><span class=big>—</span><span class=mu>' + d[2] + '</span></div><div class="track ' + (d[0] === 'gr' ? 'ac' : 'mt') + '"><div></div></div></div>').join('');
function setMeter(k, v, lo, hi, show) { const el = $('mt_' + k); if (!el._b) { el._b = el.querySelector('.track>div'); el._n = el.querySelector('.big'); } const p = isFinite(v) ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0, w = (p * 100).toFixed(1) + '%'; if (el._w !== w) { el._b.style.width = w; el._w = w; } const sv = show == null ? v : show, t = isFinite(sv) ? sv.toFixed(k === 'corr' ? 2 : 1) : '—'; if (el._t !== t) { el._n.textContent = t; el._t = t; } }
// redraw only when something changed or while playing (an always-running loop kept the CPU/GPU busy and drained batteries)
let rafId = 0;
let lastTT = '', dispP = 0;
// posisi untuk tampilan: jam audio browser melompat per blok (patah-patah di layar 144 Hz), jadi dipakai getOutputTimestamp + waktu layar lalu dihaluskan
function dispPos() {
  const t = pos(); if (!S.playing || !ac) { dispP = t; return t; }
  let tg = t; if (ac.getOutputTimestamp) { const ts = ac.getOutputTimestamp(); if (ts && ts.performanceTime > 0 && ts.contextTime > 0) { tg = ts.contextTime + (performance.now() - ts.performanceTime) / 1000 - t0; if ($('loop').checked && dur() > 0) tg = ((tg % dur()) + dur()) % dur(); tg = Math.max(0, Math.min(tg, dur())); } }
  if (Math.abs(tg - dispP) > 0.3) dispP = tg; else dispP += (tg - dispP) * 0.4;
  return dispP;
}
function kick() { if (!rafId) rafId = requestAnimationFrame(frame); }
function frame() {
  rafId = 0; if (!S.an) return;
  const p = dispPos(), fk = p * 10, k = Math.floor(fk), fr = fk - k, A = S.ab === 'B' && S.man ? S.man : S.an, Lo = A.loudness, ceilDb = S.rendered ? S.rendered.lim.ceilingDb : -1;
  // data meter tersedia tiap 100 ms: diinterpolasi supaya bergerak mulus di setiap frame layar (tidak loncat 10 kali per detik)
  const at = (arr) => { if (!arr || !arr.length) return NaN; const i = Math.max(0, Math.min(arr.length - 1, k)), a = arr[i], b = arr[Math.min(arr.length - 1, i + 1)]; return isFinite(a) && isFinite(b) ? a + (b - a) * fr : a; };
  setMeter('m', at(Lo.momentary), -40, 0); setMeter('s', at(Lo.shortTerm), -40, 0); setMeter('i', Lo.integrated, -40, 0);
  const tp = at(A.truePeak.series); setMeter('tp', tp, -30, 3); $('mt_tp').classList.toggle('hot', tp > ceilDb);
  setMeter('lra', Lo.lra, 0, 20); setMeter('plr', A.plr, 0, 24); setMeter('corr', A.stereo ? at(A.stereo.correlationSeries) : 1, -1, 1);
  const gr = S.ab === 'B' && S.report && S.report.grSeries ? at(S.report.grSeries) : 0; setMeter('gr', -gr, 0, 12, gr);
  const tt = fmtTime(p) + ' / ' + fmtTime(dur()); if (tt !== lastTT) { $('time').textContent = tt; lastTT = tt; } drawHead(p); if (S.playing) { drawSpec(); kick(); }
}
// resizing a canvas reallocates and clears it: only do it when the size really changed
function fitCanvas(c, h) { const d = DPR(), W = Math.max(300, Math.round(c.clientWidth * d)), Hh = Math.round(h * d); if (c.width !== W) c.width = W; if (c.height !== Hh) c.height = Hh; return [W, Hh, d]; }
// ---------- waveform (batang ala konsep; detail mesin tetap: puncak + RMS, dua versi, jalur GR limiter) ----------
let waveCache = null;
const WPAD = 10, WPITCH = 4.5, WBAR = 3; // px CSS: bantalan, jarak antar batang (rapat supaya detail lagu terlihat), lebar batang
function bars(wv, n) { const pk = new Float32Array(n), rm = new Float32Array(n), L = wv.peak.length; for (let k = 0; k < n; k++) { const a = Math.floor(k / n * L), b = Math.max(a + 1, Math.floor((k + 1) / n * L)); let mp = 0, sr = 0; for (let i = a; i < b && i < L; i++) { if (wv.peak[i] > mp) mp = wv.peak[i]; sr += wv.rms[i]; } pk[k] = Math.min(1, mp); rm[k] = Math.min(1, sr / (b - a)); } return [pk, rm]; }
// tinggi batang relatif terhadap rata-rata lagu itu sendiri (skala dB): lagu yang sudah dikompres tetap menampakkan naik-turun dinamikanya
function relh(arr, mid, span) { let m = 0, c = 0; const db = new Float32Array(arr.length); for (let i = 0; i < arr.length; i++) { db[i] = arr[i] > 1e-5 ? 20 * Math.log10(arr[i]) : -100; if (db[i] > -100) { m += db[i]; c++; } } m = c ? m / c : 0; const o = new Float32Array(arr.length); for (let i = 0; i < arr.length; i++) o[i] = db[i] <= -100 ? 0 : Math.max(0.06, Math.min(1, mid + (db[i] - m) / span)); return o; }
function rbar(g, x, y, w, h, r) { if (h <= 0) return; if (g.roundRect) { g.beginPath(); g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); g.fill(); } else g.fillRect(x, y, w, h); }
function drawWave() {
  const c = $('wave'); if (!c.clientWidth) return; const [W, Hh, d] = fitCanvas(c, 210), o = document.createElement('canvas'); o.width = W; o.height = Hh; const g = o.getContext('2d');
  const cInset = cssv('inset'), cRest = cssv('rest'), cSage = cssv('sage'), cAcc = cssv('accent'), cMuted = cssv('muted'), cSoft = cssv('soft');
  g.fillStyle = cInset; g.fillRect(0, 0, W, Hh); if (!S.an) { waveCache = o; return; }
  const pad = WPAD * d, pitch = WPITCH * d, bw = WBAR * d, n = Math.max(8, Math.floor((W - 2 * pad + (pitch - bw)) / pitch)), x0 = pad + ((W - 2 * pad) - (n * pitch - (pitch - bw))) / 2;
  const hasGR = !!(S.report && S.report.grSeries), lane = hasGR ? 62 * d : 0, mid = (Hh - lane) / 2, amp = mid - 4 * d;
  const showB = S.ab === 'B' && S.man, act = showB ? S.man : S.an, ghost = S.man ? (showB ? S.an : S.man) : null, cAct = showB ? cSage : cRest, cGh = showB ? cRest : cSage;
  const [pa0, ra0] = bars(act.wave, n), pa = relh(pa0, 0.8, 8), ra = relh(ra0, 0.45, 10).map((v, k) => Math.min(v, pa[k] * 0.92)), gh0 = ghost ? bars(ghost.wave, n) : null, gh = gh0 ? [relh(gh0[0], 0.8, 8)] : null;
  g.fillStyle = cSoft; g.fillRect(pad, mid, W - 2 * pad, Math.max(1, d / 2));
  // versi yang tidak sedang didengar: batang puncak transparan di belakang, supaya beda A dan B tetap terlihat
  if (gh) { g.globalAlpha = 0.55; g.fillStyle = cGh; for (let k = 0; k < n; k++) { const h = Math.max(2 * d, gh[0][k] * amp * 2); rbar(g, x0 + k * pitch, mid - h / 2, bw, h, bw / 2); } g.globalAlpha = 1; }
  // versi aktif: puncak (transparan) + inti RMS (penuh) -> dinamika lagu kelihatan
  for (let k = 0; k < n; k++) { const x = x0 + k * pitch, h = Math.max(3 * d, pa[k] * amp * 2), hr = Math.max(2 * d, ra[k] * amp * 2); g.globalAlpha = 0.5; g.fillStyle = cAct; rbar(g, x, mid - h / 2, bw, h, bw / 2); g.globalAlpha = 1; rbar(g, x, mid - hr / 2, bw, hr, bw / 2); }
  if (lane) { const gs = S.report.grSeries, L = gs.length, top = Hh - lane + 16 * d, base = Hh - 5 * d, mh = base - top; let gmax = 0; for (let j = 0; j < L; j++) if (-gs[j] > gmax) gmax = -gs[j]; const sc = Math.max(3, Math.ceil(gmax)); // skala GR menyesuaikan nilai sebenarnya agar limiter terlihat
    g.fillStyle = cSoft; g.fillRect(pad, base, W - 2 * pad, Math.max(1, d / 2));
    for (let k = 0; k < n; k++) { const a = Math.floor(k / n * L), b = Math.max(a + 1, Math.floor((k + 1) / n * L)); let mn = 0; for (let j = a; j < b && j < L; j++) if (gs[j] < mn) mn = gs[j]; const h = Math.min(1, -mn / sc) * mh; g.fillStyle = cAcc; if (h > 0.5 * d) rbar(g, x0 + k * pitch, base - Math.max(h, 2 * d), bw, Math.max(h, 2 * d), bw / 2); }
    g.fillStyle = cMuted; g.font = 10 * d + 'px JetBrains Mono, monospace'; g.fillText('limiter GR 0..' + sc + ' dB · maks ' + gmax.toFixed(1) + ' dB', pad, Hh - lane + 11 * d); }
  waveCache = o; drawHead(pos());
}
function drawHead(p) { const c = $('wave'); if (!waveCache || !c.clientWidth) return; const g = c.getContext('2d'); g.drawImage(waveCache, 0, 0); if (!S.an || !dur()) return; const d = DPR(), x = WPAD * d + p / dur() * (c.width - 2 * WPAD * d); g.fillStyle = cssv('accent'); g.fillRect(x - d, 0, 2 * d, c.height); g.fillStyle = cssv('text'); g.fillRect(x - 3 * d, 0, 6 * d, 3 * d); }
// ---------- spectrum ----------
let spCache = null, spKey = null;
function drawSpec() {
  const c = $('spec'); if (!c.clientWidth) return; const [W, Hh, d] = fitCanvas(c, 210), g = c.getContext('2d');
  const fx = (f) => Math.log(f / 20) / Math.log(1000) * W, fy = (db) => Hh - (db + 100) / 100 * (Hh - 14 * d);
  const th = root.getAttribute('data-theme') || '', key = [W, Hh, th, S.an, S.man];
  if (!spCache || !spKey || key.some((v, q) => v !== spKey[q])) { // grid, label, dan kurva rata-rata hanya digambar ulang saat berubah, bukan tiap frame
    spKey = key; const o = document.createElement('canvas'); o.width = W; o.height = Hh; const og = o.getContext('2d');
    const cInset = cssv('inset'), cSoft = cssv('soft'), cMuted = cssv('muted');
    og.fillStyle = cInset; og.fillRect(0, 0, W, Hh); og.font = 10 * d + 'px JetBrains Mono, monospace';
    [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach((f) => { og.fillStyle = cSoft; og.fillRect(fx(f), 0, 1, Hh); og.fillStyle = cMuted; og.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), fx(f) + 3, Hh - 3); });
    [-20, -40, -60, -80].forEach((v) => { og.fillStyle = cSoft; og.fillRect(0, fy(v), W, 1); og.fillStyle = cMuted; og.fillText(v + ' dB', 3, fy(v) - 2); });
    if (S.an) { const ref = S.an.spectrum.display.filter((q) => q[1] > -200); if (ref.length) { let mx = -1e9; ref.forEach((q) => { if (q[1] > mx) mx = q[1]; }); const shift = -14 - mx;
      const line = (pts, col) => { og.beginPath(); let st = false; pts.forEach((q) => { if (q[1] <= -200 || q[0] < 20 || q[0] > 20000) return; const x = fx(q[0]), y = fy(q[1] + shift); if (!st) { og.moveTo(x, y); st = true; } else og.lineTo(x, y); }); og.strokeStyle = col; og.lineWidth = 2 * d; og.stroke(); };
      line(S.an.spectrum.display, cMuted); if (S.man) line(S.man.spectrum.display, cssv('sage')); } }
    spCache = o;
  }
  g.drawImage(spCache, 0, 0);
  if (ac && S.playing && ana) { if (!specBuf || specBuf.length !== ana.frequencyBinCount) specBuf = new Float32Array(ana.frequencyBinCount); const a = specBuf; ana.getFloatFrequencyData(a); const sr = ac.sampleRate, cAcc = cssv('accent');
    g.beginPath(); g.moveTo(0, Hh); let cc = -1, cy = Hh; // satu titik per kolom piksel (nilai tertinggi), bukan ribuan lineTo per frame
    for (let i = 1; i < a.length; i++) { const f = i * sr / ana.fftSize; if (f < 20 || f > 20000) continue; const x = fx(f), y = fy(Math.max(-100, a[i] + 3 * Math.log2(f / 1000) + 8)), col = Math.floor(x / d); if (col === cc) { if (y < cy) cy = y; } else { if (cc >= 0) g.lineTo((cc + 0.5) * d, cy); cc = col; cy = y; } }
    if (cc >= 0) g.lineTo((cc + 0.5) * d, cy); g.lineTo(W, Hh); g.closePath();
    g.globalAlpha = 0.22; g.fillStyle = cAcc; g.fill(); g.globalAlpha = 1; g.strokeStyle = cAcc; g.lineWidth = 1 * d; g.stroke(); }
}
window.addEventListener('resize', () => { drawWave(); drawSpec(); kick(); });
// ---------- reports ----------
let cmpRows = [];
function renderCompare() {
  const a = S.an, m = S.man; if (!a) return; const st = (x, f) => (x.stereo ? f(x.stereo) : NaN);
  const rows = [['Integrated', (x) => x.loudness.integrated, 'LUFS', 1], ['Max short-term', (x) => x.loudness.maxShortTerm, 'LUFS', 1], ['Max momentary', (x) => x.loudness.maxMomentary, 'LUFS', 1],
    ['True peak', (x) => x.truePeak.dbtp, 'dBTP', 2], ['Sample peak', (x) => x.samplePeakDb, 'dBFS', 2], ['RMS', (x) => x.rmsDb, 'dBFS', 1], ['Loudness range', (x) => x.loudness.lra, 'LU', 1],
    ['PLR', (x) => x.plr, 'dB', 1], ['Crest factor', (x) => x.crestDb, 'dB', 1], ['DR score', (x) => x.dynamics.dr, '', 0], ['Correlation', (x) => st(x, (s) => s.correlation), '', 2],
    ['Side / Mid', (x) => st(x, (s) => s.sideToMidDb), 'dB', 1], ['Mono fold-down', (x) => st(x, (s) => s.monoFoldI - x.loudness.integrated), 'dB', 1], ['Spectral centroid', (x) => x.spectrum.centroid, 'Hz', 0],
    ['Spectral tilt', (x) => x.spectrum.tiltDbPerOct, 'dB/oct', 2], ['Sub 20-60 Hz', (x) => x.spectrum.bands.sub, 'dB', 1], ['Bass 60-250 Hz', (x) => x.spectrum.bands.bass, 'dB', 1], ['Low-mid 250-500', (x) => x.spectrum.bands.lowMid, 'dB', 1],
    ['Mid 0.5-2 kHz', (x) => x.spectrum.bands.mid, 'dB', 1], ['High-mid 2-4 kHz', (x) => x.spectrum.bands.highMid, 'dB', 1], ['Presence 4-6 kHz', (x) => x.spectrum.bands.presence, 'dB', 1], ['Air 12-20 kHz', (x) => x.spectrum.bands.air, 'dB', 1],
    ['Transient strength', (x) => x.dynamics.transientStrengthDb, 'dB', 1], ['Onset rate', (x) => x.dynamics.onsetRate, '/s', 1]];
  cmpRows = rows;
  const cell = (v, d, u) => '<span><b>' + f1(v, d) + '</b> <small>' + u + '</small></span>';
  const head = '<div class="r h"><span>Metric</span><span>Original</span><span>Master</span><span>Δ</span></div>';
  const row = (r) => { const va = r[1](a), vm = m ? r[1](m) : NaN; return '<div class=r tabindex=0 data-m="' + escHtml(r[0]) + '"><span>' + r[0] + '</span>' + cell(va, r[3], r[2]) + (m ? cell(vm, r[3], r[2]) : '<span class=d>—</span>') + '<span class=d>' + (m ? sgn(vm - va, r[3]) : '') + '</span></div>'; };
  const pick = (ix) => head + ix.map((i) => row(rows[i])).join('');
  $('cmpA').innerHTML = pick([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 22, 23]); $('cmpB').innerHTML = pick([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
}
const txt = (a) => (typeof a === 'string' ? a : Object.values(a || {}).filter((v) => typeof v === 'string' || typeof v === 'number').join(' · '));
const NOTE_TAG = { high: 'fail', fail: 'fail', warn: 'warn', medium: 'warn', warning: 'warn' };
const dxRow = (i, title, body, kind) => '<div class="dr' + (kind === 'warn' || kind === 'fail' ? ' ' + kind : '') + '"><b><i>' + String(i + 1).padStart(2, '0') + '</i>' + esc(title) + '</b>' + body + '</div>';
function renderProblems(P) { $('tDet').textContent = 'Detected' + (P && P.length ? ' · ' + P.length : ''); $('problems').innerHTML = P && P.length ? P.map((p, i) => dxRow(i, p.title, esc(p.detail) + '<em>→ ' + esc(p.fix) + '</em>', NOTE_TAG[p.severity] || 'info')).join('') : '<span class=small>No significant issues detected.</span>'; }
function renderActions(A) { $('tAda').textContent = 'Adaptive' + (A && A.length ? ' · ' + A.length : ''); $('actions').innerHTML = A && A.length ? A.map((a, i) => (a && a.stage ? dxRow(i, a.stage, esc(a.text), 'info') : dxRow(i, 'Adjustment', esc(txt(a)), 'info'))).join('') : '<span class=small>No adaptive changes - preset applied as designed.</span>'; }
function renderQC() {
  const L = (S.report && S.report.loudness) || {}, notes = ((S.report && S.report.notes) || []).map((n) => '<div class=qrow><span>' + esc(n) + '</span><span class="tag info">INFO</span></div>').join(''), ic = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', info: 'INFO' };
  $('qc').innerHTML = (S.qc || []).map((q) => '<div class=qrow><span><b>' + esc(q.title) + '</b><em>' + esc(q.value) + '</em>' + (q.status !== 'pass' && q.fix ? '<em>→ ' + esc(q.fix) + '</em>' : '') + '</span><span class="tag ' + esc(q.status) + '">' + (ic[q.status] || '') + '</span></div>').join('')
    + '<div class=qrow><span><b>Loudness stage</b><em>target ' + esc(L.target) + ' LUFS · pre-limiter ' + esc(L.preLimiterLufs) + ' · gain ' + sgn(L.gainDb) + ' dB · limiting ' + esc(L.limitingLu) + ' LU · ' + esc(L.iterations) + ' passes</em></span><span class="tag info">INFO</span></div>' + notes;
}
// ---------- advanced chain editor (unit rak, lihat rack.js): setiap kontrol menunjuk ke satu setting yang dibaca mesin ----------
function renderChain() {
  pvKick(); const s = S.settings; if (!s) { $('chain').innerHTML = '<div class=card><span class=small>Upload a track to load its chain.</span></div>'; return; }
  $('chain').innerHTML = renderRack(s, { ui: S.ui, an: S.an, man: S.man, report: S.report, fs: S.info ? S.info.fs : 44100 });
}
function setPath(o, p, v) { const ks = p.split('.'); let x = o; for (let i = 0; i < ks.length - 1; i++) x = x[ks[i]]; x[ks[ks.length - 1]] = v; }
function markEdited() { S.edited = true; updateMasterBtn(); $('editedTxt').textContent = 'Chain edited - press RE-MASTER to render with your settings'; }
const lastKey = (p) => p.split('.').pop();
// nilai tervalidasi: batas atribut min/max milik kontrol, lalu batas aman mesin (clampSetting); null = abaikan
function fit(el, raw) { let v = raw; const mn = el.dataset.min, mx = el.dataset.max; if (mn != null && isFinite(+mn)) v = Math.max(+mn, v); if (mx != null && isFinite(+mx)) v = Math.min(+mx, v); return clampSetting(lastKey(el.dataset.p), v, S.info && S.info.fs); }
function applyValue(p, v) { setPath(S.settings, p, v); markEdited(); }
function refocus(sel) { const el = $('chain').querySelector(sel); if (el) el.focus({ preventScroll: true }); }
$('chain').addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t || t.disabled || !S.settings) return; const d = t.dataset;
  if (d.open) { const n = +d.open, cur = S.ui.open[n] === undefined ? false : S.ui.open[n]; S.ui.open[n] = !cur; renderChain(); refocus('[data-open="' + n + '"]'); return; }
  if (d.ui) { S.ui[d.ui] = +d.v; renderChain(); refocus('[data-ui="' + d.ui + '"][data-v="' + d.v + '"]'); return; }
  if (d.p && d.d) { const cur = getPath(S.settings, d.p), st = +d.st || 1, step = +d.d; let v = d.mul ? (step > 0 ? cur * +d.mul : cur / +d.mul) : cur + step * st; v = d.mul ? Math.round(v * 100) / 100 : Math.round(v * 1e4) / 1e4;
    v = fit(t, v); if (v == null) return; applyValue(d.p, v); renderChain(); refocus('[data-p="' + d.p + '"][data-d="' + d.d + '"]'); return; }
  if (d.tog) { applyValue(d.tog, !getPath(S.settings, d.tog)); renderChain(); refocus('[data-tog="' + d.tog + '"]'); return; }
  if (d.set) { const v = d.t === 'number' ? +d.v : d.v; applyValue(d.set, v); renderChain(); refocus('[data-set="' + d.set + '"][data-v="' + d.v + '"]'); return; }
  if (d.add === 'eq.bands') { S.settings.eq.bands.push(newBand()); S.ui.eqSel = S.settings.eq.bands.length - 1; markEdited(); renderChain(); return; }
  if (d.del != null) { S.settings.eq.bands.splice(+d.del, 1); S.ui.eqSel = Math.max(0, Math.min(S.ui.eqSel, S.settings.eq.bands.length - 1)); markEdited(); renderChain(); }
});
// fader: angka ikut bergerak saat digeser, kurva/LCD diperbarui setelah dilepas
$('chain').addEventListener('input', (e) => { const el = e.target; if (el.type !== 'range' || !el.dataset.p || !S.settings) return; const v = fit(el, parseFloat(el.value)); if (v == null) return; setPath(S.settings, el.dataset.p, v); pvKick(); const rd = $('chain').querySelector('[data-rd="' + el.dataset.p + '"]'); if (rd) rd.textContent = (FMT[el.dataset.k] || FMT.plain)(v); });
$('chain').addEventListener('change', (e) => { const el = e.target; if (el.type !== 'range' || !el.dataset.p || !S.settings) return; const v = fit(el, parseFloat(el.value)); if (v == null) return; applyValue(el.dataset.p, v); renderChain(); refocus('[data-p="' + el.dataset.p + '"]'); });
$('btnReset').onclick = () => { S.edited = false; $('editedTxt').textContent = ''; updateMasterBtn(); if (S.an) worker.postMessage({ type: 'plan', opts: opts() }); };
// ---------- pilihan (pop-up bertema, pengganti daftar bawaan peramban; <select> asli tetap jadi sumber nilai) ----------
const CHEV = '<svg viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=3 stroke-linecap=round stroke-linejoin=round aria-hidden=true><path d="M6 9l6 6 6-6"/></svg>';
let sheetEl = null, sheetFrom = null, sheetSel = null, sheetStart = 0;
// pilihan berlaku saat pop-up ditutup (X, ketuk di luar, Escape): event change hanya dikirim bila hasil akhir berbeda dari saat dibuka
function closeSheet() { if (!sheetEl) return; const s = sheetSel, changed = !!s && s.selectedIndex !== sheetStart; sheetSel = null; sheetEl.remove(); sheetEl = null; document.removeEventListener('keydown', sheetKey, true); if (sheetFrom) { sheetFrom.focus({ preventScroll: true }); sheetFrom = null; } if (changed) s.dispatchEvent(new Event('change')); }
function sheetKey(e) {
  if (!sheetEl) return; if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSheet(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const o = [...sheetEl.querySelectorAll('.so')], i = o.indexOf(document.activeElement); if (!o.length) return; e.preventDefault(); o[Math.max(0, Math.min(o.length - 1, (i < 0 ? 0 : i) + (e.key === 'ArrowDown' ? 1 : -1)))].focus(); }
  if (e.key === 'Tab') { const o = [...sheetEl.querySelectorAll('button')], i = o.indexOf(document.activeElement); e.preventDefault(); o[(i + (e.shiftKey ? -1 : 1) + o.length) % o.length].focus(); }
}
function openSheet(sel, btn, title) {
  closeSheet(); sheetFrom = btn; sheetSel = sel; sheetStart = sel.selectedIndex;
  const back = document.createElement('div'); back.className = 'sheetback'; const box = document.createElement('div'); box.className = 'sheet'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title);
  const h = document.createElement('div'); h.className = 'sh'; const t = document.createElement('span'); t.className = 'ttl'; t.textContent = title; const x = document.createElement('button'); x.className = 'sx'; x.setAttribute('aria-label', 'Tutup'); x.innerHTML = '<svg viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=3 stroke-linecap=round aria-hidden=true><path d="M6 6l12 12M18 6L6 18"/></svg>'; x.onclick = closeSheet; h.append(t, x); box.appendChild(h);
  const list = document.createElement('div'); list.className = 'sl'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', title);
  [...sel.options].forEach((op, i) => { const b = document.createElement('button'); b.className = 'so'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', i === sel.selectedIndex); const st = document.createElement('span'); st.className = 'st'; const l1 = document.createElement('span'); l1.textContent = op.text; st.appendChild(l1); const ds = selOptionDesc(sel.id, op.value); if (ds) { const s2 = document.createElement('small'); s2.className = 'sd'; s2.textContent = ds; st.appendChild(s2); } b.appendChild(st);
    b.onclick = () => { sel.selectedIndex = i; syncSel(sel); list.querySelectorAll('.so').forEach((o, k) => o.setAttribute('aria-selected', k === i ? 'true' : 'false')); b.focus({ preventScroll: true }); }; list.appendChild(b); });
  box.appendChild(list); const ab = selAbout(sel.id); if (ab) { const f = document.createElement('div'); f.className = 'sf'; f.textContent = ab; box.appendChild(f); } back.appendChild(box); back.addEventListener('click', (e) => { if (e.target === back) closeSheet(); }); document.body.appendChild(back); sheetEl = back; document.addEventListener('keydown', sheetKey, true);
  (list.querySelector('[aria-selected=true]') || list.firstChild).focus({ preventScroll: true }); const cur = list.querySelector('[aria-selected=true]'); if (cur) cur.scrollIntoView({ block: 'center' });
}
function syncSel(sel) { const b = sel._btn; if (b) b.querySelector('.sv').textContent = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : ''; }
function enhanceSelects() {
  document.querySelectorAll('select.sel').forEach((sel) => {
    const lab = sel.getAttribute('aria-labelledby') && $(sel.getAttribute('aria-labelledby')), title = lab ? lab.textContent : 'Pilih';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sel selbtn'; b.id = sel.id + 'Btn'; b.setAttribute('aria-haspopup', 'listbox'); if (lab) b.setAttribute('aria-labelledby', lab.id + ' ' + b.id);
    b.innerHTML = '<span class=sv></span>' + CHEV; b.onclick = () => openSheet(sel, b, title); sel._btn = b; sel.hidden = true; sel.after(b); syncSel(sel);
  });
}
// ---------- init ----------
try { const th = localStorage.getItem('lintang-theme'); if (th === 'dark' || th === 'light') root.setAttribute('data-theme', th); } catch (e) {}
setTheme(root.getAttribute('data-theme') || 'light', false);
// ---------- tata letak: TAB (5 bagian + bar bawah) atau SCROLL (semua di satu halaman, seperti semula) ----------
const TAB_OF = { 'Upload audio': 'upload', 'Genre preset': 'preset', 'Processing chain': 'master', 'Master': 'master', 'Player': 'master', 'Meters': 'analisis', 'Spectrum analyzer': 'analisis', 'Analysis and comparison': 'analisis', 'Detected issues': 'analisis', 'Diagnosis': 'analisis', 'Quality control': 'analisis', 'Export': 'export' };
document.querySelectorAll('main.page section[aria-label]').forEach((el) => { const t = TAB_OF[el.getAttribute('aria-label')]; if (t) el.dataset.tab = t; });
let curTab = 'upload';
function setTab(t) { curTab = t; const on = document.body.classList.contains('laytab'); document.querySelectorAll('main.page [data-tab]').forEach((el) => el.classList.toggle('th', on && el.dataset.tab !== t)); [...$('tabbar').children].forEach((b) => { const a = b.dataset.t === t; b.classList.toggle('on', a); b.setAttribute('aria-pressed', a); }); window.scrollTo(0, 0); requestAnimationFrame(() => { drawWave(); drawSpec(); kick(); }); }
function setLayout(m, save) { document.body.classList.toggle('laytab', m === 'tab'); $('layTxt').textContent = 'LAYAR: ' + (m === 'tab' ? 'TAB' : 'SCROLL'); $('layBtn').setAttribute('aria-pressed', m === 'tab'); if (save) { try { localStorage.setItem('lintang-layout', m); } catch (e) {} } setTab(curTab); }
$('tabbar').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) setTab(b.dataset.t); });
$('layBtn').onclick = () => setLayout(document.body.classList.contains('laytab') ? 'scroll' : 'tab', true);
let lay = 'tab'; try { lay = localStorage.getItem('lintang-layout') || 'tab'; } catch (e) {}
setLayout(lay === 'scroll' ? 'scroll' : 'tab', false);
enhanceSelects(); fillGenres(); renderExpl(); renderChain(); drawWave(); drawSpec(); kick();
function bindSwipe(box, tabs) {
  const el = $(box), bs = [...$(tabs).children];
  const sync = () => { const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth)); bs.forEach((b, k) => { b.classList.toggle('on', k === i); b.setAttribute('aria-selected', k === i ? 'true' : 'false'); }); };
  bs.forEach((b, k) => { b.onclick = () => el.scrollTo({ left: k * el.clientWidth, behavior: 'smooth' }); });
  el.addEventListener('scroll', sync, { passive: true }); sync();
}
bindSwipe('cmpg', 'cmpt'); bindSwipe('dxg', 'dxt');
// tahan satu baris tabel Analysis untuk melihat detail metriknya (sumber: engine/analysis.js dan loudness.js)
function openMetric(name) {
  const info = METRIC_INFO[name], r = cmpRows.find((x) => x[0] === name); if (!info || !r || !S.an) return; closeSheet(); sheetFrom = null;
  const va = r[1](S.an), vm = S.man ? r[1](S.man) : NaN, u = r[2] ? ' ' + r[2] : '', fv = (v) => (isFinite(v) ? f1(v, r[3]) + u : '—');
  const back = document.createElement('div'); back.className = 'sheetback'; const box = document.createElement('div'); box.className = 'sheet'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', info.title);
  const h = document.createElement('div'); h.className = 'sh'; const t = document.createElement('span'); t.className = 'ttl'; t.textContent = name; const x = document.createElement('button'); x.className = 'sx'; x.setAttribute('aria-label', 'Tutup'); x.innerHTML = '<svg viewBox=\"0 0 24 24\" fill=none stroke=currentColor stroke-width=3 stroke-linecap=round aria-hidden=true><path d=\"M6 6l12 12M18 6L6 18\"/></svg>'; x.onclick = closeSheet; h.append(t, x); box.appendChild(h);
  const body = document.createElement('div'); body.className = 'ib';
  body.innerHTML = '<div class=iv><span>Original <b>' + escHtml(fv(va)) + '</b></span><span>Master <b>' + escHtml(fv(vm)) + '</b></span></div><h4>' + escHtml(info.title) + '</h4><h4>Cara dihitung</h4><ul>' + info.how.map((q) => '<li>' + escHtml(q) + '</li>').join('') + '</ul><h4>Cara membaca</h4><p>' + escHtml(info.read) + '</p><h4>Sumber di mesin</h4><p class=src>' + escHtml(info.src) + '</p>';
  box.appendChild(body); back.appendChild(box); back.addEventListener('click', (e) => { if (e.target === back) closeSheet(); }); document.body.appendChild(back); sheetEl = back; document.addEventListener('keydown', sheetKey, true); x.focus({ preventScroll: true });
}
(function () {
  const el = $('cmpg'); let t = null, x0 = 0, y0 = 0, row = null;
  const clear = () => { if (t) { clearTimeout(t); t = null; } if (row) row.classList.remove('press'); };
  el.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; clear(); row = e.target.closest('.r[data-m]'); if (!row) return; row.classList.add('press'); const r = row; t = setTimeout(() => { t = null; r.classList.remove('press'); try { if (navigator.vibrate) navigator.vibrate(15); } catch (_) {} openMetric(r.dataset.m); }, 450); });
  el.addEventListener('pointermove', (e) => { if (t && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) clear(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => el.addEventListener(n, clear));
  el.addEventListener('contextmenu', (e) => { if (e.target.closest('.r[data-m]')) e.preventDefault(); });
  el.addEventListener('keydown', (e) => { const r = e.target.closest && e.target.closest('.r[data-m]'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openMetric(r.dataset.m); } });
})();

enhanceSelects(); fillGenres(); renderChain(); drawWave(); drawSpec(); kick();
