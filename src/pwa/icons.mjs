// src/pwa/icons.mjs - ikon aplikasi (PNG) dibuat langsung oleh build, tanpa dependency dan tanpa file biner di repo.
// Gambar: latar grafit + lima batang gelombang oranye (warna aksen aplikasi).
import zlib from 'zlib';

const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (type, data) => {
  const t = Buffer.from(type, 'ascii'), len = Buffer.alloc(4), cr = Buffer.alloc(4);
  len.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, cr]);
};
export function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 bit, RGBA
  const raw = Buffer.alloc((1 + 4 * w) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (1 + 4 * w) + 1, y * 4 * w, (y + 1) * 4 * w); // filter byte = 0 (None)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export const BG = [23, 23, 26], FG = [255, 90, 31];
const BARS = [0.34, 0.6, 0.86, 0.52, 0.3]; // tinggi relatif tiap batang

// maskable=true: latar penuh tanpa sudut transparan (OS yang memotong bentuknya) dan gambar di zona aman tengah.
export function makeIcon(size, maskable = false) {
  const S = 3, N = size * S, rgba = Buffer.alloc(size * size * 4);
  const area = size * (maskable ? 0.5 : 0.6), left = (size - area) / 2, pitch = area / BARS.length, bw = pitch * 0.58, cy = size / 2, rad = size * 0.2;
  const inBg = (x, y) => {
    if (maskable) return true;
    const dx = Math.max(rad - x, x - (size - rad), 0), dy = Math.max(rad - y, y - (size - rad), 0);
    return dx * dx + dy * dy <= rad * rad;
  };
  const inBar = (x, y) => {
    const i = Math.floor((x - left) / pitch); if (i < 0 || i >= BARS.length) return false;
    const bx = left + (i + 0.5) * pitch, half = (BARS[i] * area) / 2, r = bw / 2, ax = Math.abs(x - bx), ay = Math.abs(y - cy);
    if (ax > r || ay > half) return false;
    const cap = Math.max(0, ay - (half - r)); return ax * ax + cap * cap <= r * r;
  };
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let a = 0, rr = 0, gg = 0, bb = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const x = px + (sx + 0.5) / S, y = py + (sy + 0.5) / S;
      if (!inBg(x, y)) continue;
      const c = inBar(x, y) ? FG : BG; a++; rr += c[0]; gg += c[1]; bb += c[2];
    }
    const o = (py * size + px) * 4;
    if (a) { rgba[o] = Math.round(rr / a); rgba[o + 1] = Math.round(gg / a); rgba[o + 2] = Math.round(bb / a); rgba[o + 3] = Math.round((255 * a) / (S * S)); }
  }
  return encodePng(size, size, rgba);
}
