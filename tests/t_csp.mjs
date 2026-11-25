// tests/t_csp.mjs - CSP ketat yang dibuat build.mjs (meta di dist/index.html): hash skrip inline, tanpa unsafe-inline/eval/blob di script-src.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { suite } from './lib/harness.mjs';
import { buildDist, DIST, ROOT } from './lib/build.mjs';

const t = suite('csp');
const r = t.attempt('build.mjs selesai tanpa error', buildDist);
if (!r) t.done();
const { html, worklet } = r;

t.section('meta CSP dari build');
const m = html.match(/<meta http-equiv=Content-Security-Policy content="([^"]*)">/);
t.ok('ada satu <meta> Content-Security-Policy', !!m && (html.match(/http-equiv=Content-Security-Policy/g) || []).length === 1);
const csp = m ? m[1] : '';
const dir = (n) => { const x = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(n + ' ')); return x ? x.slice(n.length + 1).split(/\s+/) : null; };
t.ok('meta CSP muncul sebelum <script> atau <style> pertama', html.indexOf('http-equiv=Content-Security-Policy') < Math.min(...['<script', '<style'].map((x) => html.indexOf(x)).filter((i) => i >= 0)));
t.ok("default-src 'none' (semua yang tidak disebut ditutup)", (dir('default-src') || []).join() === "'none'");

t.section('script-src ketat');
const ss = dir('script-src') || [];
t.ok("script-src tanpa 'unsafe-inline', 'unsafe-eval', 'strict-dynamic', blob:, data:, dan host luar", ss.length > 0 && ss.every((x) => x === "'self'" || /^'sha256-[A-Za-z0-9+/]+={0,2}'$/.test(x)), ss.join(' '));
const exec = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter((x) => !/type=text\/plain/.test(x[1]));
const want = exec.map((x) => "'sha256-" + crypto.createHash('sha256').update(x[2]).digest('base64') + "'");
t.ok('ada hash untuk aplikasi dan pwa-boot (dua skrip yang dieksekusi)', exec.length === 2 && want.length === 2, 'skrip=' + exec.length);
t.ok('setiap skrip inline yang dieksekusi punya hash yang cocok persis di script-src', want.every((h) => ss.includes(h)));
t.ok('tidak ada hash berlebih (hash tanpa skrip)', ss.filter((x) => x.startsWith("'sha256-")).length === want.length);
t.ok('blok teks worker (type=text/plain) tidak dieksekusi, jadi tidak perlu hash', /<script id=worker-src type=text\/plain>/.test(html));

t.section('arahan lain');
t.ok('worker-src mengizinkan blob: (worker mesin dari Blob) dan self (service worker)', (dir('worker-src') || []).includes('blob:') && (dir('worker-src') || []).includes("'self'"));
t.ok("object-src, base-uri, form-action semuanya 'none'", ['object-src', 'base-uri', 'form-action'].every((n) => (dir(n) || []).join() === "'none'"));
t.ok('connect-src hanya self/blob:/data: (tanpa jaringan luar)', (dir('connect-src') || []).every((x) => ["'self'", 'blob:', 'data:'].includes(x)));
t.ok('tidak ada host http(s) di CSP', !/https?:/i.test(csp));
t.ok('font-src mengizinkan data: (font ditanam)', (dir('font-src') || []).includes('data:'));
const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const hdr = vj.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy');
t.ok('vercel.json tetap membawa frame-ancestors none (tidak bisa lewat <meta>)', !!hdr && /frame-ancestors 'none'/.test(hdr.value) && !/frame-ancestors/.test(csp));

t.section('kode tidak melanggar CSP');
const app = exec.map((x) => x[2]).find((c) => c.length > 1000) || '';
t.ok('tidak ada eval, new Function, atau setTimeout/setInterval berisi string', !/\beval\s*\(|new\s+Function\s*\(|set(Timeout|Interval)\s*\(\s*['"`]/.test(app));
t.ok('tidak ada atribut handler inline (onclick=, dst.) di HTML maupun templat innerHTML', !/<[a-z][^>]*\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')) && !/['"`][^'"`\n]*<[a-z][^'"`\n]*\son[a-z]+\s*=/i.test(app));
t.ok('tidak ada URL javascript: atau document.write / window.open', !/javascript:|document\.write|window\.open/.test(html));
t.ok('worklet dimuat dari berkas satu origin, bukan Blob', /addModule\('preview-worklet\.js'\)/.test(app) && !/addModule\(url\)/.test(app));
const sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
t.ok('preview-worklet.js ada di pra-cache service worker (jalan offline)', /PRECACHE = \[[^\]]*'preview-worklet\.js'/.test(sw) && fs.existsSync(path.join(DIST, 'preview-worklet.js')));
t.ok('dist/preview-worklet.js berisi processor lintang-preview', /registerProcessor\(("|')lintang-preview/.test(worklet));
t.ok('app menampilkan pelanggaran CSP di status (tidak gagal diam-diam)', /securitypolicyviolation/.test(app));
t.ok('banner CSP hanya untuk skrip/worker milik sendiri (toolbar Vercel, ekstensi, manifest hanya ke konsol)', /location\.origin/.test(app) && /script-src\|worker-src/.test(app));
t.done();
