// meta.js - embedded tags (ID3v2 / RIFF INFO / FLAC Vorbis comment / AIFF text chunks) read on the UI thread, display only
const dec = (u, a, b) => { try { return new TextDecoder('utf-8').decode(u.subarray(a, b)).replace(/\0+$/g, '').trim(); } catch (e) { return ''; } };
const u32le = (u, o) => (u[o] | u[o + 1] << 8 | u[o + 2] << 16 | u[o + 3] << 24) >>> 0, u32be = (u, o) => (u[o] << 24 | u[o + 1] << 16 | u[o + 2] << 8 | u[o + 3]) >>> 0;
const ID3 = { TIT2: 'Judul', TPE1: 'Artis', TALB: 'Album', TYER: 'Tahun', TDRC: 'Tahun', TCON: 'Genre', TRCK: 'Track', TBPM: 'BPM', TKEY: 'Kunci', TPE2: 'Artis album', TCOM: 'Komposer', TSSE: 'Encoder', TENC: 'Encoder', TCOP: 'Copyright' };
const RIFF = { INAM: 'Judul', IART: 'Artis', IPRD: 'Album', ICRD: 'Tanggal', IGNR: 'Genre', ICMT: 'Komentar', ISFT: 'Software', ICOP: 'Copyright', ITRK: 'Track', IENG: 'Engineer' };
const VORB = { TITLE: 'Judul', ARTIST: 'Artis', ALBUM: 'Album', DATE: 'Tanggal', GENRE: 'Genre', TRACKNUMBER: 'Track', COMMENT: 'Komentar', ENCODER: 'Encoder', COMPOSER: 'Komposer' };
export function parseTags(u) {
  const out = []; const add = (k, v) => { if (v && !out.some((r) => r[0] === k && r[1] === v)) out.push([k, v.slice(0, 160)]); };
  try {
    if (u[0] === 0x49 && u[1] === 0x44 && u[2] === 0x33) { // ID3v2
      const end = Math.min(u.length, 10 + ((u[6] & 127) << 21 | (u[7] & 127) << 14 | (u[8] & 127) << 7 | (u[9] & 127))); let o = 10, pics = 0;
      while (o + 10 < end) { const id = String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]), sz = u[3] === 4 ? ((u[o + 4] & 127) << 21 | (u[o + 5] & 127) << 14 | (u[o + 6] & 127) << 7 | (u[o + 7] & 127)) : u32be(u, o + 4); if (!sz || !/^[A-Z0-9]{4}$/.test(id)) break;
        if (ID3[id]) { const e = u[o + 10]; add(ID3[id], new TextDecoder(e === 1 ? 'utf-16' : e === 3 ? 'utf-8' : 'latin1').decode(u.subarray(o + 11, o + 10 + sz)).replace(/\0+/g, '').trim()); } else if (id === 'APIC') pics++;
        o += 10 + sz; }
      if (pics) add('Cover art', 'ada (' + pics + ')');
    } else if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46) { // RIFF (WAV) LIST/INFO
      let o = 12; while (o + 8 <= u.length) { const id = dec(u, o, o + 4), sz = u32le(u, o + 4); if (id === 'LIST' && dec(u, o + 8, o + 12) === 'INFO') { let p = o + 12; const e = o + 8 + sz; while (p + 8 <= e) { const k = dec(u, p, p + 4), s = u32le(u, p + 4); if (RIFF[k]) add(RIFF[k], dec(u, p + 8, p + 8 + s)); p += 8 + s + (s & 1); } } o += 8 + sz + (sz & 1); }
    } else if (u[0] === 0x66 && u[1] === 0x4c && u[2] === 0x61 && u[3] === 0x43) { // FLAC
      let o = 4; for (;;) { const h = u[o], sz = u[o + 1] << 16 | u[o + 2] << 8 | u[o + 3]; if ((h & 127) === 4) { let p = o + 4; const vl = u32le(u, p); p += 4 + vl; const n = u32le(u, p); p += 4; for (let i = 0; i < n; i++) { const l = u32le(u, p), s = dec(u, p + 4, p + 4 + l), q = s.indexOf('='); if (q > 0) add(VORB[s.slice(0, q).toUpperCase()] || s.slice(0, q), s.slice(q + 1)); p += 4 + l; } } else if ((h & 127) === 6) add('Cover art', 'ada'); if (h & 128 || o > 1e6) break; o += 4 + sz; }
    } else if (u[0] === 0x46 && u[1] === 0x4f && u[2] === 0x52 && u[3] === 0x4d) { // AIFF
      let o = 12; const T = { NAME: 'Judul', AUTH: 'Artis', '(c) ': 'Copyright', ANNO: 'Komentar' }; while (o + 8 <= u.length) { const id = dec(u, o, o + 4), sz = u32be(u, o + 4); if (T[id]) add(T[id], dec(u, o + 8, o + 8 + sz)); o += 8 + sz + (sz & 1); }
    }
  } catch (e) { /* tags are optional */ }
  return out;
}
