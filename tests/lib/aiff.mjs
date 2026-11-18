// tests/lib/aiff.mjs - penulis AIFF minimal (PCM big-endian) untuk menguji dekoder.
// Engine hanya punya dekoder AIFF, jadi file ujinya dibuat di sini.
export function makeAiff(chans, fs, bits = 16) {
  const nch = chans.length, n = chans[0].length, bps = bits / 8, dataLen = n * nch * bps;
  const comm = 18, ssnd = 8 + dataLen, pad = ssnd & 1;
  const buf = new Uint8Array(12 + (8 + comm) + (8 + ssnd + pad)), dv = new DataView(buf.buffer);
  const tag = (o, s) => { for (let i = 0; i < 4; i++) buf[o + i] = s.charCodeAt(i); };
  tag(0, 'FORM'); dv.setUint32(4, buf.length - 8); tag(8, 'AIFF');
  let p = 12;
  tag(p, 'COMM'); dv.setUint32(p + 4, comm); dv.setInt16(p + 8, nch); dv.setUint32(p + 10, n); dv.setInt16(p + 14, bits);
  const e = Math.floor(Math.log2(fs));
  dv.setUint16(p + 16, 16383 + e); dv.setBigUint64(p + 18, BigInt(fs) << BigInt(63 - e));
  p += 8 + comm;
  tag(p, 'SSND'); dv.setUint32(p + 4, ssnd); dv.setUint32(p + 8, 0); dv.setUint32(p + 12, 0);
  let o = p + 16;
  const max = Math.pow(2, bits - 1);
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) {
    const v = Math.max(-max, Math.min(max - 1, Math.round(chans[c][i] * max)));
    if (bps === 2) dv.setInt16(o, v);
    else if (bps === 3) { buf[o] = (v >> 16) & 255; buf[o + 1] = (v >> 8) & 255; buf[o + 2] = v & 255; }
    else dv.setInt32(o, v);
    o += bps;
  }
  return buf;
}
