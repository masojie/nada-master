// preview-worklet.js - AudioWorklet jalur preview cepat (dibundel jadi teks oleh build.mjs, dimuat dari Blob, tanpa jaringan).
// Aturan: process() tidak membuat objek/array baru kecuali pesan meter ~6 kali per detik. DSP ada di preview-core.js.
import { PreviewCore, DEFAULT_PARAMS } from './preview-core.js';
const CAP = 2048, REPORT_EVERY = 64;
class LintangPreview extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new PreviewCore(sampleRate, DEFAULT_PARAMS);
    this.iL = new Float64Array(CAP); this.iR = new Float64Array(CAP); this.oL = new Float64Array(CAP); this.oR = new Float64Array(CAP);
    this.m = new Float64Array(8); this.blocks = 0; this.msAcc = 0; this.expect = -1; this.glitch = 0;
    this.port.onmessage = (e) => { const d = e.data; if (d && d.params) { this.core.setParams(d.params); if (d.settle) this.core.settle(); } else if (d && d.reset) this.core.reset(); };
  }
  process(inputs, outputs) {
    const o = outputs[0], n = Math.min(o[0].length, CAP), inp = inputs[0], t0 = Date.now();
    // blok yang terlewat: currentFrame melompat lebih dari satu blok sejak pemanggilan sebelumnya
    // 64 blok pertama tidak dihitung: konteks audio baru bangun dan jam sering melompat saat start (bukan patah-patah saat memutar)
    if (this.blocks >= REPORT_EVERY && this.expect >= 0 && currentFrame > this.expect) this.glitch += Math.max(1, Math.round((currentFrame - this.expect) / n));
    this.expect = currentFrame + n;
    if (!inp || !inp.length || !inp[0].length) { for (let c = 0; c < o.length; c++) o[c].fill(0); return true; }
    const a = inp[0], b = inp.length > 1 ? inp[1] : inp[0], iL = this.iL, iR = this.iR, oL = this.oL, oR = this.oR;
    for (let i = 0; i < n; i++) { iL[i] = a[i]; iR[i] = b[i]; }
    this.core.process(iL, iR, oL, oR, n);
    const y0 = o[0], y1 = o.length > 1 ? o[1] : null;
    for (let i = 0; i < n; i++) { y0[i] = oL[i]; if (y1) y1[i] = oR[i]; }
    // beban CPU: selisih Date.now() (1 ms) per blok dijumlahkan; penaksir tak bias karena batas milidetik jatuh acak
    this.msAcc += Date.now() - t0;
    if (++this.blocks % REPORT_EVERY === 0) {
      this.core.readMeters(this.m); const budget = REPORT_EVERY * n / sampleRate * 1000;
      this.port.postMessage({ cpu: this.msAcc / budget, glitch: this.glitch, m: this.m }); this.msAcc = 0;
    }
    return true;
  }
}
registerProcessor('lintang-preview', LintangPreview);
