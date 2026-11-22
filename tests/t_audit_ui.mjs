// tests/t_audit_ui.mjs - regresi audit 2026-11-19: NM-06, NM-08, NM-09, NM-10, NM-12, NM-16 (UI)
import fs from 'fs';
import { suite } from './lib/harness.mjs';
import { escHtml, safeFileName, exportFileName, clampSetting } from '../src/ui/ui-util.js';

const t = suite('audit-ui');
const Q1 = String.fromCharCode(39), Q2 = String.fromCharCode(34), bad = new RegExp('[' + Q1 + Q2 + '<>]');

t.section('NM-08: escaping dan nama file');
const evil = 'x' + Q2 + ' onmouseover=alert(1) y=' + Q2 + '<img src=x>' + Q1;
t.ok('escHtml menetralkan < > & dan kedua jenis kutip', !bad.test(escHtml(evil)) && escHtml('a&b') === 'a&amp;b', escHtml(evil));
const name = exportFileName(evil, { genre: 'pop-modern', mode: 'modern' }, 24, 44100, 'wav');
t.ok('nama file export tanpa karakter HTML', !bad.test(name) && name.endsWith('_NADA_pop-modern_modern_24bit_44100.wav'), name);
t.ok('nama Unicode tetap terbaca', safeFileName('Lagu Cinta 雨 (Live)') === 'Lagu Cinta 雨 (Live)', safeFileName('Lagu Cinta 雨 (Live)'));
t.ok('slash dan titik dua diganti', !/[/:]/.test(safeFileName('a/b:c')), safeFileName('a/b:c'));

t.section('NM-16: batas nilai Advanced');
t.ok('ceiling dibatasi <= 0 dBTP', clampSetting('ceilingDb', 5) === 0 && clampSetting('ceilingDb', -1.5) === -1.5);
t.ok('frekuensi dibatasi di bawah Nyquist, 0 tetap berarti mati', clampSetting('f', 30000, 44100) <= 0.45 * 44100 && clampSetting('bassMonoHz', 0, 44100) === 0);
t.ok('nilai tidak finite ditolak', clampSetting('ratio', NaN) === null);

t.section('UI (pemeriksaan sumber app.js)');
const app = fs.readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');
t.ok('NM-06: export memakai setting yang dirender', app.includes('ceilingDb: S.rendered.lim.ceilingDb'));
t.ok('NM-08: link export dibangun lewat DOM', app.includes('link.download = name') && !app.includes('JSON.stringify(name)'));
t.ok('NM-09: object URL export di-revoke', app.includes('URL.revokeObjectURL(S.exportUrl)'));
t.ok('NM-10: tidak ada loop animasi tanpa syarat', !app.includes('requestAnimationFrame(frame); if (!S.an) return;'));
t.ok('NM-12: tidak ada stage atau kontrol tanpa fungsi', !app.includes('Dither & export defaults') && !app.includes(Q1 + 'adaptive' + Q1 + '];'));

t.done();
