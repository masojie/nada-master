// ui-util.js - pure UI helpers (no DOM, testable in Node): HTML escaping, safe export file names, Advanced-editor value limits
const Q1 = String.fromCharCode(39), Q2 = String.fromCharCode(34), BS = String.fromCharCode(92);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', [Q1]: '&#39;', [Q2]: '&quot;' }, ESC_RE = new RegExp('[&<>' + Q1 + Q2 + ']', 'g');
// escapes all five HTML-significant characters (the former esc() missed the double quote)
export function escHtml(s) { return String(s == null ? '' : s).replace(ESC_RE, (c) => ESC[c]); }
// keeps letters and digits of any script, spaces and . _ ( ) + - ; quotes, slashes, < > : * ? | and control characters become _
const NAME_RE = new RegExp('[^' + BS + 'p{L}' + BS + 'p{N} ._()+-]+', 'gu');
export function safeFileName(s) { return String(s == null ? '' : s).replace(NAME_RE, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 120) || 'track'; }
export function exportFileName(base, meta, bits, fs, ext) { const m = meta || {}; return safeFileName(base) + '_NADA_' + safeFileName(m.genre || 'master') + '_' + (m.mode ? safeFileName(m.mode) : '') + '_' + (bits | 0) + 'bit_' + (fs | 0) + '.' + (ext === 'flac' ? 'flac' : 'wav'); }
const LIMITS = { ceilingDb: [-6, 0], targetLufs: [-30, -6], refLufs: [-36, -6], maxLimitLu: [0, 12], trimDb: [-12, 0], driveDb: [-12, 24], thrDb: [-80, 6], ratio: [1, 20], kneeDb: [0, 24], mix: [0, 100], width: [0, 200], monoAmount: [0, 100], amount: [0, 100], q: [0.1, 18], rangeDb: [0, 24], lookaheadMs: [0.5, 10], bias: [0, 0.6], os: [1, 8], rumbleSlope: [12, 24], slope: [12, 24], freq: [1000, 20000] };
const ZERO_OFF = { bassMonoHz: 1, scHpfHz: 1 };
// value limited to a safe range for the setting key; null for a non-finite value
export function clampSetting(key, v, fs) {
  if (!Number.isFinite(v)) return null;
  let r = LIMITS[key];
  if (!r && (key === 'f' || /Hz$/.test(key))) r = [ZERO_OFF[key] ? 0 : 10, Math.floor(0.45 * (fs || 44100))];
  else if (!r && /Ms$/.test(key)) r = [0, 5000];
  else if (!r && (key === 'g' || /Db$/.test(key))) r = [-24, 24];
  return r ? Math.min(r[1], Math.max(r[0], v)) : v;
}
