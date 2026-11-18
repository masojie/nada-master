// app.js - UI thread: upload/decode, A/B player, meters, visualisation, advanced 12-stage chain editor
import { GENRES, CATEGORIES, VOICINGS, MODES, LOUDNESS_TARGETS } from '../engine/settings.js';
import { detectFormat, mp3Info } from '../engine/codecs.js';
const $ = (id) => document.getElementById(id);
const S = { an: null, man: null, info: null, report: null, qc: null, settings: null, edited: false, bufA: null, bufB: null, ab: 'A', playing: false, busy: false, fileName: 'track' };
const VN = { balanced: 'Balanced', vocalClarity: 'Vocal Clarity', warmAnalog: 'Warm Analog', punchy: 'Punchy', bright: 'Bright', smooth: 'Smooth' };
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }; ESC[String.fromCharCode(39)] = '&#39;';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>']/g, (c) => ESC[c]);
const f1 = (v, d = 1) => (v == null || !isFinite(v) ? '—' : (+v).toFixed(d));
const sgn = (v, d = 1) => (v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + (+v).toFixed(d));
const fmtTime = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60); return m + ':' + (t - m * 60).toFixed(1).padStart(4, '0'); };
const DPR = () => window.devicePixelRatio || 1;
// ---------- engine worker ----------
const wsrc = $('worker-src');
const worker = wsrc ? new Worker(URL.createObjectURL(new Blob([wsrc.textContent], { type: 'text/javascript' }))) : new Worker('engine-worker.js');
const H = {};
worker.onmessage = (e) => { const h = H[e.data.type]; if (h) h(e.data); };
worker.onerror = (e) => fail('Engine error: ' + (e.message || 'worker failed'));
function status(t, c) { const el = $('status'); el.textContent = t; el.className = 'status ' + (c || ''); }
function fail(msg) { busy(false); status(msg, 'err'); $('progTxt').textContent = msg; }
function busy(b) { S.busy = b; $('btnMaster').disabled = b || !S.an; $('btnExport').disabled = b || !S.bufB; document.body.classList.toggle('busy', b); }
function progress(p, t) { $('progBar').style.width = (p * 100).toFixed(1) + '%'; $('progTxt').textContent = t || ''; }
H.error = (m) => fail('Error: ' + m.message);
// ---------- preset controls ----------
CATEGORIES.forEach((c, i) => $('cat').add(new Option(c, i)));
function fillGenres() { const ci = +$('cat').value, sel = $('genre'); sel.innerHTML = ''; GENRES.filter((g) => g.categoryIndex === ci).forEach((g) => sel.add(new Option(g.name, g.id))); showGenre(); }
function showGenre() { const g = GENRES.find((x) => x.id === $('genre').value); $('genreDesc').textContent = g ? g.description + ' · default ' + g.lufs + ' LUFS' : ''; }
Object.keys(VOICINGS).forEach((k) => $('voicing').add(new Option(VN[k] || k, k)));
LOUDNESS_TARGETS.forEach((t) => $('loud').add(new Option(t.name, t.id)));
let mode = 'modern';
MODES.forEach((m) => { const b = document.createElement('button'); b.textContent = m.name; b.title = m.desc; if (m.id === mode) b.className = 'on';
  b.onclick = () => { mode = m.id; [...$('modes').children].forEach((x) => x.classList.toggle('on', x === b)); onPreset(); }; $('modes').appendChild(b); });
function opts() { return { genre: $('genre').value, mode, voicing: $('voicing').value, loudness: $('loud').value, customLufs: +$('custom').value, ceilingDb: +$('ceil').value, adaptive: $('adaptive').checked }; }
function onPreset() { $('customWrap').classList.toggle('hide', $('loud').value !== 'custom'); S.edited = false; updateMasterBtn(); if (S.an) worker.postMessage({ type: 'plan', opts: opts() }); }
$('cat').onchange = () => { fillGenres(); onPreset(); };
$('genre').onchange = () => { showGenre(); onPreset(); };
['voicing', 'loud', 'ceil', 'adaptive', 'custom'].forEach((id) => { $(id).onchange = onPreset; });
H.plan = (m) => { if (!S.edited) { S.settings = m.settings; renderChain(); } renderProblems(m.problems); renderActions(m.actions); };
$('uiMode').onclick = (e) => { const v = e.target.dataset.v; if (!v) return; [...$('uiMode').children].forEach((b) => b.classList.toggle('on', b === e.target)); $('advCard').classList.toggle('hide', v !== 'advanced'); };
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
    const buf = await f.arrayBuffer(), u8 = new Uint8Array(buf), kind = detectFormat(u8);
    if (kind === 'wav' || kind === 'aiff' || kind === 'flac') { worker.postMessage({ type: 'decode', buffer: buf, name: f.name }, [buf]); return; }
    const mi = kind === 'mp3' ? mp3Info(u8) : null, OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OAC(2, 1, mi ? mi.sampleRate : 48000), ab = await ctx.decodeAudioData(buf.slice(0));
    const chans = []; for (let c = 0; c < Math.min(2, ab.numberOfChannels); c++) chans.push(new Float32Array(ab.getChannelData(c)));
    worker.postMessage({ type: 'pcm', chans, fs: ab.sampleRate, info: { name: f.name, size: f.size, codec: kind === 'mp3' ? 'MP3 (decoded at native rate)' : 'Browser-decoded', bitDepth: kind === 'mp3' ? 'lossy' : 'float' } }, chans.map((c) => c.buffer));
  } catch (err) { fail('Could not decode file: ' + err.message); }
}
function makeBuffer(pcm, fs) { const b = new AudioBuffer({ length: pcm[0].length, numberOfChannels: pcm.length, sampleRate: fs }); pcm.forEach((c, i) => b.copyToChannel(c, i)); return b; }
H.loaded = (m) => {
  const i = m.info; S.an = m.analysis; S.info = i; S.man = null; S.report = null; S.qc = null; S.bufB = null; S.edited = false;
  S.bufA = makeBuffer(m.pcm, i.fs); off = 0; setAB('A');
  $('fileInfo').innerHTML = '<b>' + esc(i.name) + '</b><br>' + esc(i.codec) + ' · ' + esc(i.bitDepth) + (typeof i.bitDepth === 'number' ? '-bit' : '') + ' · ' + i.fs + ' Hz · ' + (i.channels === 1 ? 'mono' : 'stereo') + ' · ' + fmtTime(i.duration) + (i.note ? '<br>' + esc(i.note) : '');
  $('btnPlay').disabled = false; $('btnStop').disabled = false; $('abB').disabled = true; busy(false); updateMasterBtn();
  status('Analysed in ' + (i.ms / 1000).toFixed(1) + ' s - choose a genre preset, then press MASTER', 'ok'); progress(0, '');
  $('qc').textContent = 'Master a track to run QC.'; $('exportOut').innerHTML = ''; renderCompare(); drawWave(); drawSpec(); updateDelta();
  worker.postMessage({ type: 'plan', opts: opts() });
};
// ---------- master & export ----------
const STAGES = ['pre', 'eq', 'dyneq', 'comp', 'mb', 'sat', 'stereo', 'tone', 'loud', 'analysis'];
$('btnMaster').onclick = () => { if (!S.an || S.busy) return; busy(true); progress(0.03, 'Starting…'); const msg = { type: 'master', opts: opts() }; if (S.edited) msg.settings = S.settings; worker.postMessage(msg); };
H.progress = (m) => { const i = STAGES.indexOf(m.id); progress(i < 0 ? 0.05 : (i + 1) / (STAGES.length + 1), m.label + '…'); status(m.label + '…'); };
function updateMasterBtn() { $('btnMaster').textContent = S.edited ? 'RE-MASTER (edited chain)' : (S.bufB ? 'RE-MASTER' : 'MASTER'); }
H.mastered = (m) => {
  S.man = m.analysis; S.report = m.report; S.qc = m.qc; S.settings = m.settings; S.edited = m.edited; S.bufB = makeBuffer(m.pcm, m.analysis.fs);
  busy(false); $('abB').disabled = false; progress(1, 'Rendered in ' + (m.ms / 1000).toFixed(1) + ' s');
  const L = m.report.loudness || {};
  status('Mastered: ' + f1(m.analysis.loudness.integrated) + ' LUFS · ' + f1(m.analysis.truePeak.dbtp, 2) + ' dBTP' + (L.capped ? ' · loudness capped to protect dynamics' : '') + ' - compare A/B, then export', 'ok');
  renderActions(m.actions); renderProblems(m.problems); renderQC(); renderCompare(); renderChain(); drawWave(); drawSpec(); updateMasterBtn(); setAB('B');
  if (S.playing) startPlay(pos());
};
$('btnExport').onclick = () => { if (!S.bufB || S.busy) return; const fb = $('fmt').value.split(':'); busy(true); progress(0.5, 'Encoding and verifying…');
  worker.postMessage({ type: 'export', opts: { format: fb[0], bits: +fb[1], sampleRate: +$('sr').value, dither: $('dither').value, ceilingDb: S.settings.lim.ceilingDb } }); };
H.exported = (m) => {
  busy(false); progress(1, 'Export ready (' + (m.ms / 1000).toFixed(1) + ' s)'); const ext = m.opts.format === 'flac' ? 'flac' : 'wav', meta = S.settings.meta || {};
  const name = S.fileName + '_NADA_' + (meta.genre || 'master') + '_' + (meta.mode || '') + '_' + m.opts.bits + 'bit_' + m.fs + '.' + ext;
  const url = URL.createObjectURL(new Blob([m.bytes], { type: ext === 'flac' ? 'audio/flac' : 'audio/wav' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  $('exportOut').innerHTML = '<a class=dl href=' + url + ' download=' + JSON.stringify(name) + '>⬇ ' + esc(name) + '</a><br>' + (m.bytes.byteLength / 1048576).toFixed(1) + ' MB · dither: ' + esc(m.dither) + m.checks.map((c) => '<div class=' + (c.ok ? 'pass' : 'fail') + '>' + (c.ok ? '✔ ' : '✖ ') + esc(c.title) + ': ' + esc(c.value) + '</div>').join('');
  status(m.ok ? 'Export verified - file downloaded' : 'Export verification reported issues', m.ok ? 'ok' : 'err');
};
// ---------- A/B player ----------
let ac = null, gA, gB, ana, anL, anR, srcA = null, srcB = null, t0 = 0, off = 0;
function ensureAC() {
  if (ac) return; ac = new (window.AudioContext || window.webkitAudioContext)(); gA = ac.createGain(); gB = ac.createGain(); const mix = ac.createGain(); gA.connect(mix); gB.connect(mix);
  ana = ac.createAnalyser(); ana.fftSize = 8192; ana.smoothingTimeConstant = 0.78; mix.connect(ana); ana.connect(ac.destination);
  const sp = ac.createChannelSplitter(2); mix.connect(sp); anL = ac.createAnalyser(); anR = ac.createAnalyser(); anL.fftSize = 2048; anR.fftSize = 2048; sp.connect(anL, 0); sp.connect(anR, 1);
}
const dur = () => (S.bufA ? S.bufA.duration : 0);
function pos() { if (!S.playing || !ac) return off; let p = ac.currentTime - t0; if ($('loop').checked && dur() > 0) p = p % dur(); return Math.max(0, Math.min(p, dur())); }
function stopSources() { for (const s of [srcA, srcB]) if (s) { s.onended = null; try { s.stop(); } catch (e) {} s.disconnect(); } srcA = null; srcB = null; }
function startPlay(at) {
  if (!S.bufA) return; ensureAC(); if (ac.state === 'suspended') ac.resume(); stopSources();
  const o = Math.min(at == null ? off : at, Math.max(0, dur() - 0.01)), when = ac.currentTime + 0.03, lp = $('loop').checked;
  srcA = ac.createBufferSource(); srcA.buffer = S.bufA; srcA.loop = lp; srcA.connect(gA);
  if (S.bufB) { srcB = ac.createBufferSource(); srcB.buffer = S.bufB; srcB.loop = lp; srcB.connect(gB); }
  srcA.start(when, o); if (srcB) srcB.start(when, o); t0 = when - o; S.playing = true; applyAB(true); $('btnPlay').textContent = '❚❚';
  srcA.onended = () => { if (S.playing && !$('loop').checked) { S.playing = false; off = 0; stopSources(); $('btnPlay').textContent = '▶'; } };
}
function stopPlay() { if (S.playing) off = pos(); S.playing = false; stopSources(); $('btnPlay').textContent = '▶'; }
function matchGains() { let a = 1, b = 1; if ($('lmatch').checked && S.man && S.an) { const d = S.man.loudness.integrated - S.an.loudness.integrated; if (isFinite(d)) { if (d > 0) b = Math.pow(10, -d / 20); else a = Math.pow(10, d / 20); } } return [a, b]; }
function applyAB(instant) { if (!ac) return; const g = matchGains(), t = ac.currentTime, tc = instant ? 0.001 : 0.012; gA.gain.setTargetAtTime(S.ab === 'A' ? g[0] : 0, t, tc); gB.gain.setTargetAtTime(S.ab === 'B' && S.bufB ? g[1] : 0, t, tc); }
function setAB(v) { S.ab = v; $('abA').classList.toggle('on', v === 'A'); $('abB').classList.toggle('on', v === 'B'); applyAB(); updateDelta(); }
function updateDelta() {
  if (!S.man || !S.an) { $('delta').textContent = ''; return; }
  const dI = S.man.loudness.integrated - S.an.loudness.integrated, dT = S.man.truePeak.dbtp - S.an.truePeak.dbtp, g = matchGains();
  $('delta').innerHTML = 'Δ Loudness <b>' + sgn(dI) + ' LU</b> · Δ True peak <b>' + sgn(dT, 2) + ' dB</b> · Δ LRA <b>' + sgn(S.man.loudness.lra - S.an.loudness.lra) + ' LU</b> - ' + ($('lmatch').checked ? 'loudness-matched: ' + (g[1] < 1 ? 'master' : 'original') + ' turned down ' + f1(-20 * Math.log10(Math.min(g[0], g[1]))) + ' dB for a fair comparison' : 'not matched (the louder version will seem better)');
}
$('btnPlay').onclick = () => (S.playing ? stopPlay() : startPlay());
$('btnStop').onclick = () => { stopPlay(); off = 0; };
$('abA').onclick = () => setAB('A');
$('abB').onclick = () => { if (S.bufB) setAB('B'); };
$('lmatch').onchange = () => { applyAB(); updateDelta(); };
$('loop').onchange = () => { if (S.playing) startPlay(pos()); };
document.addEventListener('keydown', (e) => { const tg = e.target.tagName; if (tg === 'INPUT' || tg === 'SELECT') return; if (e.code === 'Space' && S.bufA) { e.preventDefault(); $('btnPlay').onclick(); } if (e.key === 'a' || e.key === 'A') setAB('A'); if ((e.key === 'b' || e.key === 'B') && S.bufB) setAB('B'); });
$('wave').addEventListener('click', (e) => { if (!S.bufA) return; const r = e.target.getBoundingClientRect(), p = (e.clientX - r.left) / r.width * dur(); if (S.playing) startPlay(p); else off = p; });
// ---------- meters ----------
const METERS = [['m', 'Momentary', 'LUFS', -40, 0], ['s', 'Short-term', 'LUFS', -40, 0], ['i', 'Integrated', 'LUFS', -40, 0], ['tp', 'True peak', 'dBTP', -30, 3], ['lra', 'Loudness range', 'LU', 0, 20], ['plr', 'Peak-to-loudness', 'dB', 0, 24], ['corr', 'Phase correlation', '', -1, 1], ['gr', 'Limiter GR', 'dB', 0, 12]];
$('meters').innerHTML = METERS.map((d) => '<div class=mtr id=mt_' + d[0] + '><div class=mn>' + d[1] + '</div><div class=mb><div class=mf></div></div><div class=mv><b>—</b> ' + d[2] + '</div></div>').join('');
function setMeter(k, v, lo, hi, show) { const el = $('mt_' + k); const p = isFinite(v) ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0; el.querySelector('.mf').style.width = (p * 100).toFixed(1) + '%'; el.querySelector('b').textContent = isFinite(show == null ? v : show) ? (show == null ? v : show).toFixed(k === 'corr' ? 2 : 1) : '—'; }
function frame() {
  requestAnimationFrame(frame); if (!S.an) return;
  const p = pos(), k = Math.floor(p * 10), A = S.ab === 'B' && S.man ? S.man : S.an, Lo = A.loudness;
  const at = (arr) => (arr && arr.length ? arr[Math.max(0, Math.min(arr.length - 1, k))] : NaN);
  setMeter('m', at(Lo.momentary), -40, 0); setMeter('s', at(Lo.shortTerm), -40, 0); setMeter('i', Lo.integrated, -40, 0);
  const tp = at(A.truePeak.series); setMeter('tp', tp, -30, 3); $('mt_tp').classList.toggle('hot', tp > -1.0);
  setMeter('lra', Lo.lra, 0, 20); setMeter('plr', A.plr, 0, 24); setMeter('corr', A.stereo ? at(A.stereo.correlationSeries) : 1, -1, 1);
  const gr = S.ab === 'B' && S.report && S.report.grSeries ? at(S.report.grSeries) : 0; setMeter('gr', -gr, 0, 12, gr);
  $('time').textContent = fmtTime(p) + ' / ' + fmtTime(dur()); drawHead(p); if (S.playing) drawSpec();
}
requestAnimationFrame(frame);
// ---------- waveform ----------
let waveCache = null;
function drawWave() {
  const c = $('wave'), d = DPR(), W = (c.width = Math.max(300, c.clientWidth * d)), Hh = (c.height = 170 * d), o = document.createElement('canvas'); o.width = W; o.height = Hh; const g = o.getContext('2d');
  g.fillStyle = '#0b1220'; g.fillRect(0, 0, W, Hh); if (!S.an) { waveCache = o; return; }
  const lane = S.report && S.report.grSeries ? 26 * d : 0, mid = (Hh - lane) / 2, amp = mid * 0.95;
  g.fillStyle = '#1b2738'; g.fillRect(0, mid, W, 1);
  const plot = (wv, cp, cr) => { const n = wv.peak.length; for (let x = 0; x < W; x++) { const i = Math.floor(x / W * n), pk = Math.min(1.05, wv.peak[i]), rm = Math.min(1.05, wv.rms[i]); g.fillStyle = cp; g.fillRect(x, mid - pk * amp, 1, 2 * pk * amp); g.fillStyle = cr; g.fillRect(x, mid - rm * amp, 1, 2 * rm * amp); } };
  if (S.man) plot(S.man.wave, 'rgba(34,211,238,0.30)', 'rgba(56,189,248,0.55)');
  plot(S.an.wave, 'rgba(123,155,200,0.45)', 'rgba(150,180,220,0.75)');
  if (lane) { const gs = S.report.grSeries, n = gs.length; g.fillStyle = '#101a28'; g.fillRect(0, Hh - lane, W, lane);
    for (let x = 0; x < W; x++) { const a = Math.floor(x / W * n), b = Math.max(a + 1, Math.floor((x + 1) / W * n)); let mn = 0; for (let j = a; j < b && j < n; j++) if (gs[j] < mn) mn = gs[j]; const h = Math.min(1, -mn / 12) * (lane - 4); if (h > 0) { g.fillStyle = '#f97316'; g.fillRect(x, Hh - lane + 2, 1, h); } }
    g.fillStyle = '#93a4b8'; g.font = 10 * d + 'px sans-serif'; g.fillText('limiter GR 0..12 dB', 6 * d, Hh - lane + 12 * d); }
  waveCache = o; drawHead(pos());
}
function drawHead(p) { const c = $('wave'); if (!waveCache) return; const g = c.getContext('2d'); g.drawImage(waveCache, 0, 0); if (!S.an || !dur()) return; const x = p / dur() * c.width; g.fillStyle = '#ffffff'; g.fillRect(x, 0, 2, c.height); }
// ---------- spectrum ----------
function drawSpec() {
  const c = $('spec'), d = DPR(), W = (c.width = Math.max(300, c.clientWidth * d)), Hh = (c.height = 220 * d), g = c.getContext('2d');
  g.fillStyle = '#0b1220'; g.fillRect(0, 0, W, Hh);
  const fx = (f) => Math.log(f / 20) / Math.log(1000) * W, fy = (db) => Hh - (db + 100) / 100 * (Hh - 14 * d);
  g.font = 10 * d + 'px sans-serif'; g.fillStyle = '#5d6f86';
  [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach((f) => { g.fillStyle = '#16212f'; g.fillRect(fx(f), 0, 1, Hh); g.fillStyle = '#5d6f86'; g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), fx(f) + 3, Hh - 3); });
  [-20, -40, -60, -80].forEach((v) => { g.fillStyle = '#16212f'; g.fillRect(0, fy(v), W, 1); g.fillStyle = '#5d6f86'; g.fillText(v + ' dB', 3, fy(v) - 2); });
  if (ac && S.playing && ana) { const a = new Float32Array(ana.frequencyBinCount); ana.getFloatFrequencyData(a); const sr = ac.sampleRate;
    g.beginPath(); g.moveTo(0, Hh); for (let i = 1; i < a.length; i++) { const f = i * sr / ana.fftSize; if (f < 20 || f > 20000) continue; g.lineTo(fx(f), fy(Math.max(-100, a[i] + 3 * Math.log2(f / 1000) + 8))); } g.lineTo(W, Hh); g.closePath();
    g.fillStyle = 'rgba(47,140,255,0.28)'; g.fill(); g.strokeStyle = 'rgba(47,140,255,0.8)'; g.lineWidth = 1 * d; g.stroke(); }
  if (!S.an) return; const ref = S.an.spectrum.display.filter((q) => q[1] > -200); if (!ref.length) return; let mx = -1e9; ref.forEach((q) => { if (q[1] > mx) mx = q[1]; }); const shift = -14 - mx;
  const line = (pts, col) => { g.beginPath(); let st = false; pts.forEach((q) => { if (q[1] <= -200 || q[0] < 20 || q[0] > 20000) return; const x = fx(q[0]), y = fy(q[1] + shift); if (!st) { g.moveTo(x, y); st = true; } else g.lineTo(x, y); }); g.strokeStyle = col; g.lineWidth = 2 * d; g.stroke(); };
  line(S.an.spectrum.display, '#7b9bc8'); if (S.man) line(S.man.spectrum.display, '#22d3ee');
}
window.addEventListener('resize', () => { drawWave(); drawSpec(); });
// ---------- reports ----------
function renderCompare() {
  const a = S.an, m = S.man; if (!a) return; const st = (x, f) => (x.stereo ? f(x.stereo) : NaN);
  const rows = [['Integrated', (x) => x.loudness.integrated, 'LUFS', 1], ['Max short-term', (x) => x.loudness.maxShortTerm, 'LUFS', 1], ['Max momentary', (x) => x.loudness.maxMomentary, 'LUFS', 1],
    ['True peak', (x) => x.truePeak.dbtp, 'dBTP', 2], ['Sample peak', (x) => x.samplePeakDb, 'dBFS', 2], ['RMS', (x) => x.rmsDb, 'dBFS', 1], ['Loudness range', (x) => x.loudness.lra, 'LU', 1],
    ['PLR', (x) => x.plr, 'dB', 1], ['Crest factor', (x) => x.crestDb, 'dB', 1], ['DR score', (x) => x.dynamics.dr, '', 0], ['Correlation', (x) => st(x, (s) => s.correlation), '', 2],
    ['Side / Mid', (x) => st(x, (s) => s.sideToMidDb), 'dB', 1], ['Mono fold-down', (x) => st(x, (s) => s.monoFoldI - x.loudness.integrated), 'dB', 1], ['Spectral centroid', (x) => x.spectrum.centroid, 'Hz', 0],
    ['Spectral tilt', (x) => x.spectrum.tiltDbPerOct, 'dB/oct', 2], ['Sub 20-60 Hz', (x) => x.spectrum.bands.sub, 'dB', 1], ['Bass 60-250 Hz', (x) => x.spectrum.bands.bass, 'dB', 1], ['Low-mid 250-500', (x) => x.spectrum.bands.lowMid, 'dB', 1],
    ['Mid 0.5-2 kHz', (x) => x.spectrum.bands.mid, 'dB', 1], ['High-mid 2-4 kHz', (x) => x.spectrum.bands.highMid, 'dB', 1], ['Presence 4-6 kHz', (x) => x.spectrum.bands.presence, 'dB', 1], ['Air 12-20 kHz', (x) => x.spectrum.bands.air, 'dB', 1],
    ['Transient strength', (x) => x.dynamics.transientStrengthDb, 'dB', 1], ['Onset rate', (x) => x.dynamics.onsetRate, '/s', 1]];
  $('cmp').innerHTML = '<tr><th>Metric</th><th>Original</th><th>Master</th><th>Δ</th></tr>' + rows.map((r) => { const va = r[1](a), vm = m ? r[1](m) : NaN; return '<tr><td>' + r[0] + '</td><td>' + f1(va, r[3]) + ' <small>' + r[2] + '</small></td><td>' + (m ? f1(vm, r[3]) + ' <small>' + r[2] + '</small>' : '—') + '</td><td>' + (m ? sgn(vm - va, r[3]) : '') + '</td></tr>'; }).join('');
}
const txt = (a) => (typeof a === 'string' ? a : Object.values(a || {}).filter((v) => typeof v === 'string' || typeof v === 'number').join(' · '));
function renderProblems(P) { $('problems').innerHTML = P && P.length ? P.map((p) => '<div class=\u0027it ' + esc(p.severity) + '\u0027><b>' + esc(p.title) + '</b><span>' + esc(p.detail) + '</span><em>→ ' + esc(p.fix) + '</em></div>').join('') : '<div class=\u0027it pass\u0027><b>No significant issues detected</b></div>'; }
function renderActions(A) { $('actions').innerHTML = A && A.length ? A.map((a) => '<div class=\u0027it info\u0027>' + esc(txt(a)) + '</div>').join('') : '<div class=it>No adaptive changes - preset applied as designed.</div>'; }
function renderQC() {
  const L = (S.report && S.report.loudness) || {}, notes = ((S.report && S.report.notes) || []).map((n) => '<div class=\u0027it info\u0027>' + esc(n) + '</div>').join(''), ic = { pass: '✔', warn: '▲', fail: '✖', info: 'ℹ' };
  $('qc').innerHTML = (S.qc || []).map((q) => '<div class=\u0027it ' + esc(q.status) + '\u0027><b>' + (ic[q.status] || '') + ' ' + esc(q.title) + '</b><span>' + esc(q.value) + '</span>' + (q.status !== 'pass' && q.fix ? '<em>→ ' + esc(q.fix) + '</em>' : '') + '</div>').join('')
    + '<div class=\u0027it info\u0027><b>Loudness stage</b><span>target ' + esc(L.target) + ' LUFS · pre-limiter ' + esc(L.preLimiterLufs) + ' · gain ' + sgn(L.gainDb) + ' dB · limiting ' + esc(L.limitingLu) + ' LU · ' + esc(L.iterations) + ' passes</span></div>' + notes;
}
// ---------- advanced chain editor (every field maps 1:1 to the settings the DSP engine renders) ----------
const TITLES = { pre: '1 · Pre-processing', eq: '2 · Corrective EQ', dyneq: '3 · Dynamic EQ', comp: '4 · Bus compression', mb: '5 · Multiband compression', sat: '6 · Saturation & harmonics', stereo: '7 · Stereo image', tone: '8 · Tonal enhancement', clip: '9 · Clipper', lim: '10 · True-peak limiter', loud: '11 · Loudness management', output: '12 · Dither & export defaults', adaptive: 'Adaptive correction' };
const OPTS = { phase: ['minimum', 'linear'], style: ['transparent', 'balanced', 'punchy'], mode: ['soft', 'hard'], ch: ['stereo', 'mid', 'side'], type: ['bell', 'lowshelf', 'highshelf', 'hp', 'lp', 'notch'], os: [1, 2, 4, 8], rumbleSlope: [12, 24], slope: [12, 24], dither: ['auto', 'tpdf', 'shaped', 'none'], format: ['wav', 'flac'] };
function human(k) { return String(k).replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).replace(/ Db$/, ' (dB)').replace(/ Hz$/, ' (Hz)').replace(/ Ms$/, ' (ms)').replace(/ Lu$/, ' (LU)').replace(/ Lufs$/, ' (LUFS)'); }
function input(id, k, v) {
  if (typeof v === 'boolean') return '<input type=checkbox data-p=' + id + (v ? ' checked' : '') + '>';
  if (OPTS[k]) return '<select data-p=' + id + ' data-t=' + typeof v + '>' + OPTS[k].map((o) => '<option' + (String(o) === String(v) ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>';
  if (typeof v === 'number') return '<input type=number step=any data-p=' + id + ' value=' + (+v.toFixed(3)) + '>';
  return '<input type=text data-p=' + id + ' value=\u0027' + esc(v) + '\u0027>';
}
function field(id, k, v) { return typeof v === 'boolean' ? '<label class=\u0027chk f\u0027>' + input(id, k, v) + ' ' + human(k) + '</label>' : '<label class=f>' + human(k) + input(id, k, v) + '</label>'; }
function renderBands(arr, path) {
  const keys = []; arr.forEach((b) => Object.keys(b).forEach((k) => { if (!keys.includes(k) && (b[k] === null || typeof b[k] !== 'object')) keys.push(k); }));
  const del = path.join('.') === 'eq.bands';
  return '<div class=bands><table><tr>' + keys.map((k) => '<th>' + human(k) + '</th>').join('') + (del ? '<th></th>' : '') + '</tr>' + arr.map((b, i) => '<tr>' + keys.map((k) => '<td>' + (b[k] == null ? '' : input(path.concat(i, k).join('.'), k, b[k])) + '</td>').join('') + (del ? '<td><button class=x data-del=eq.bands.' + i + '>✕</button></td>' : '') + '</tr>').join('') + '</table></div>';
}
function renderObj(obj, path) {
  let h = '';
  for (const k of Object.keys(obj)) { const v = obj[k]; if (k === 'bypass' || v == null) continue;
    if (Array.isArray(v)) h += v.length && typeof v[0] === 'object' ? renderBands(v, path.concat(k)) : '<div class=\u0027f arr\u0027>' + human(k) + '<br>' + v.map((x, i) => '<input type=number step=any data-p=' + path.concat(k, i).join('.') + ' value=' + x + '>').join('') + '</div>';
    else if (typeof v === 'object') h += '<fieldset><legend>' + human(k) + '</legend>' + renderObj(v, path.concat(k)) + '</fieldset>';
    else h += field(path.concat(k).join('.'), k, v); }
  return h;
}
function stageSummary(r) { if (!r) return ''; if (r.bypassed) return 'bypassed in last render'; const o = []; if (r.thrDb != null) o.push('thr ' + f1(r.thrDb) + ' dB'); if (r.maxGrDb != null) o.push('max GR ' + f1(r.maxGrDb) + ' dB'); if (r.gainDb != null) o.push('gain ' + sgn(r.gainDb) + ' dB'); if (r.distortionDb != null) o.push('distortion ' + f1(r.distortionDb) + ' dB'); if (r.levelChangeDb != null) o.push('level ' + sgn(r.levelChangeDb, 2) + ' dB'); if (r.bands) o.push(r.bands.length + ' bands'); return o.join(' · '); }
function renderChain() {
  const s = S.settings; if (!s) return; const order = ['pre', 'eq', 'dyneq', 'comp', 'mb', 'sat', 'stereo', 'tone', 'clip', 'lim', 'loud', 'output', 'adaptive'];
  $('chain').innerHTML = order.filter((k) => s[k]).map((k) => { const st = s[k], rep = S.report && S.report.stages ? S.report.stages[k] : null;
    return '<details class=\u0027stage' + (st.bypass ? ' byp' : '') + '\u0027' + (k === 'eq' ? ' open' : '') + '><summary><span>' + (TITLES[k] || k) + '</span>' + ('bypass' in st ? '<label class=chk><input type=checkbox data-p=' + k + '.bypass' + (st.bypass ? ' checked' : '') + '> Bypass</label>' : '') + '<small>' + esc(stageSummary(rep)) + '</small></summary><div class=sbody>' + renderObj(st, [k]) + (k === 'eq' ? '<button class=\u0027btn small\u0027 data-add=eq.bands>+ Add EQ band</button>' : '') + '</div></details>'; }).join('');
}
function setPath(o, p, v) { const ks = p.split('.'); let x = o; for (let i = 0; i < ks.length - 1; i++) x = x[ks[i]]; x[ks[ks.length - 1]] = v; }
function markEdited() { S.edited = true; updateMasterBtn(); status('Chain edited - press RE-MASTER to render with your settings', 'warn'); }
$('chain').addEventListener('change', (e) => {
  const el = e.target, p = el.dataset.p; if (!p || !S.settings) return; let v;
  if (el.type === 'checkbox') v = el.checked; else if (el.type === 'number' || el.dataset.t === 'number') { v = parseFloat(el.value); if (!isFinite(v)) return; } else v = el.value;
  setPath(S.settings, p, v); if (p.endsWith('.bypass')) el.closest('details').classList.toggle('byp', v); markEdited();
});
$('chain').addEventListener('click', (e) => {
  const t = e.target; if (t.dataset.add === 'eq.bands') { S.settings.eq.bands.push({ on: true, type: 'bell', f: 1000, g: 0, q: 1, ch: 'stereo', auto: false }); renderChain(); markEdited(); }
  if (t.dataset.del) { S.settings.eq.bands.splice(+t.dataset.del.split('.')[2], 1); renderChain(); markEdited(); }
});
$('btnReset').onclick = () => { S.edited = false; updateMasterBtn(); if (S.an) worker.postMessage({ type: 'plan', opts: opts() }); };
// ---------- init ----------
fillGenres(); drawWave(); drawSpec();
