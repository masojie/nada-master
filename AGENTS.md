# AGENTS.md: panduan kerja untuk AI dan developer di NADA Master

Dokumen ini wajib dibaca sebelum mengubah apa pun. Tujuannya satu: setiap perubahan harus terbukti benar, bukan sekadar terlihat benar.

## Produk dalam satu paragraf

NADA Master adalah workstation mastering audio berbasis browser. Prosesnya DSP deterministik (rule-based), tanpa AI. Audio pengguna tidak pernah meninggalkan perangkat: seluruh proses berjalan di Web Worker di browser. Hasil dengan input dan setting yang sama harus identik bit demi bit.

## Aturan yang tidak boleh dilanggar

1. **Jangan klaim selesai sebelum diuji.** Sebelum menyatakan sebuah perubahan selesai, jalankan `npm test` dan `npm run build`, lalu laporkan hasil aslinya (jumlah lulus, gagal, todo). Kalau tidak bisa menjalankan, katakan terus terang bahwa belum diuji.
2. **Jangan melemahkan tes supaya lulus.** Dilarang menghapus pernyataan, menaikkan toleransi, atau mengganti `ok()` menjadi `todo()` tanpa alasan tertulis. Kalau sebuah tes memang salah, jelaskan kenapa di pesan commit.
3. **Jangan ada tombol palsu atau fitur tanpa fungsi di UI.** Setiap kontrol harus benar-benar mengubah hasil, atau tidak ditampilkan.
4. **Privasi.** Dilarang memakai `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, CDN, font eksternal, analitik, atau URL `http(s)://` di `src/`. Dijaga oleh `tests/t_sources.mjs` dan `tests/t_build.mjs`.
5. **Tanpa dependency npm.** `package.json` tidak punya dependencies dan build harus tetap `node build.mjs`. Kalau ingin menambah dependency (misalnya bundler), minta persetujuan pemilik dulu.
6. **Angka preset adalah titik awal, bukan fakta.** Jangan mengubah angka genre atau mode tanpa alasan yang diukur (kurva spektrum, loudness, atau perbandingan telinga dengan referensi) dan tulis alasannya di pesan commit.
7. **Satu perubahan per commit**, dengan pesan yang menjelaskan apa dan kenapa.
8. **Kerja berat tidak dijalankan di sandbox chat.** Render panjang dan tes besar dijalankan lewat GitHub Actions (`.github/workflows/ci.yml`), karena sandbox sering mati di tengah jalan.

## Perintah

```bash
npm test                         # semua tes (sekitar 1,5 menit)
npm run test:fast                # tanpa tes yang ditandai // @slow (sekitar 5 detik)
node tests/run-all.mjs chain     # hanya file tes yang namanya memuat "chain"
node tests/run-all.mjs --verbose # tampilkan seluruh keluaran
npm run build                    # node build.mjs, hasil di dist/
npm run check                    # tes lalu build
```

Butuh Node.js 22 atau lebih baru. Tidak ada `npm install`.

## Peta kode

```
src/engine/     mesin DSP (tanpa DOM, bisa jalan di Node)
  loudness.js   K-weighting, BS.1770 gating, true peak (TPInterp 48 tap, 4x di bawah 120 kHz, 2x di atasnya)
  limiter.js    limiter true-peak dengan lookahead
  chain.js      render 12 tahap dan pencarian loudness
  modules.js    EQ, kompresor, multiband, saturasi, stereo, tone, clipper
  analysis.js   analisis sumber dan hasil
  adaptive.js   koreksi adaptif berbasis aturan
  settings.js   preset + mode + target menjadi setting lengkap
  qc.js         pemeriksaan kualitas otomatis
  codecs.js, flac.js, exporter.js, dither.js, resample.js
src/presets/    katalog 68 genre, voicing, validator
src/ui/         index.html, app.js, styles.css (satu-satunya kode yang menyentuh DOM), ui-util.js, rack.js, genre-view.js (helper murni berupa string, diuji di Node)
  fonts/        Archivo dan JetBrains Mono (woff2, lisensi OFL), ditanam ke dist/index.html oleh build.mjs sebagai data URI; jangan pakai CDN
src/worker.js   jembatan pesan: decode, pcm, plan, master, export
build.mjs       bundler buatan sendiri: hasil dist/index.html dan dist/engine-worker.js
tests/          suite tes (lihat di bawah)
```

Alur data: file -> `decode` atau `pcm` -> analisis -> `plan` (setting) -> `master` (render 12 tahap + QC) -> `export`. UI berbicara dengan worker hanya lewat pesan.

## Batasan bundler (penting)

`build.mjs` membaca modul baris demi baris dan hanya paham bentuk berikut. Bentuk lain menghasilkan bundel yang salah tanpa pesan error.

```js
import { a, b } from './x.js';          // satu baris, path relatif, wajib berakhiran .js
export function nama() {}               // juga class, const, let, var, async function
export { a, b };                        // satu baris, tanpa "as"
```

Dilarang: import berbaris-baris, `import x from`, `import * as`, `export default`, `export { x as y }`, `export ... from`, `import()` dinamis, `import.meta`, impor melingkar, dan beberapa deklarasi dalam satu `export const a = 1, b = 2`. `tests/t_sources.mjs` menolak semuanya dan memeriksa bahwa setiap nama yang diimpor benar-benar diekspor.

## Invarian DSP (diuji, jangan dilanggar)

- Output selalu finite (tanpa NaN atau Infinity), dengan jumlah frame, kanal, dan sample rate yang sama dengan input.
- Input tidak pernah dimodifikasi oleh `renderMaster` (tombol Re-master bergantung pada ini).
- True peak tidak melewati ceiling: meter engine paling banyak ceiling + 0,05 dB, gelombang kontinu paling banyak ceiling + 0,5 dB.
- Loudness mencapai target dalam 0,5 LU, kecuali engine menyatakan `capped` untuk menjaga dinamika.
- Deterministik: tanpa `Math.random`, dither memakai seed tetap, dua render dengan input dan setting sama identik bit demi bit. `Date.now()` hanya untuk pengukuran waktu, tidak boleh memengaruhi audio.
- Export lolos verifikasi bit-exact (decode ulang lalu bandingkan) di semua format dan sample rate.

## Menulis tes baru

Semua tes ada di `tests/t_*.mjs` dan ditemukan otomatis oleh `tests/run-all.mjs`. Tidak ada file audio eksternal: gunakan sinyal sintetis.

```js
import { suite } from './lib/harness.mjs';
import * as S from './lib/signals.mjs';          // music(), sine(), sweep(), pinkNoise(), impulse(), pengukur independen
import { master } from './lib/pipeline.mjs';     // analisis -> plan -> render -> QC persis seperti worker

const t = suite('contoh');
const chans = S.music(48000, 8, { style: 'pop', peakDb: -3 });   // seed tetap, hasil selalu sama
const r = master(chans, 48000, 'pop-modern', 'modern');
t.ok('output finite', S.allFinite(r.out.chans));
t.atMost('puncak sampel <= ceiling', S.peakDb(r.out.chans), r.settings.lim.ceilingDb + 0.05, ' dBFS');
t.done();
```

- Tandai file lambat dengan `// @slow` di salah satu dari 5 baris pertama.
- `t.todo(judul, kondisi, info)` untuk bug nyata yang sudah dicatat dan belum diperbaiki. Gagal berarti TODO (tidak menggagalkan, tetapi selalu didaftar di akhir). Begitu bug diperbaiki, ganti menjadi `t.ok()`.
- Pengukur di `signals.mjs` (`peakDb`, `rmsDb`, `truePeakDb`) ditulis terpisah dari engine supaya tidak memakai kode yang sedang diuji sebagai alat ukur.
- Setiap tes baru harus bisa gagal. Uji dengan menyabot kodenya sebentar dan pastikan tes memerah.

## CSP ketat (dibuat build)

- `build.mjs` menyisipkan `<meta http-equiv=Content-Security-Policy>` di `dist/index.html`: `default-src 'none'` dan `script-src 'self'` ditambah hash SHA-256 tiap skrip inline yang dieksekusi (aplikasi dan pwa-boot). Hash dihitung ulang tiap build, jadi mengubah isi skrip tidak butuh langkah tambahan.
- Dilarang: `eval`, `new Function`, `setTimeout('string')`, atribut handler inline (`onclick=` dan sejenisnya, termasuk di templat `innerHTML`), URL `javascript:`, skrip inline baru di luar `build.mjs`, dan menambah `'unsafe-inline'`, `'unsafe-eval'`, `blob:` atau `data:` ke `script-src`. Dijaga `tests/t_csp.mjs`.
- Worker mesin dimuat dari Blob (diizinkan `worker-src blob:`). Worklet preview dimuat dari berkas `preview-worklet.js` karena worklet diatur `script-src`, bukan `worker-src`; berkas itu ada di pra-cache service worker.
- `frame-ancestors` tidak bisa lewat `<meta>`, jadi tetap di `vercel.json`. `style-src` masih `'unsafe-inline'` (ada atribut `style=` di templat): celah yang diketahui, tetapi injeksi gaya tidak menjalankan skrip.
- Kalau browser memblokir sesuatu, status bar menampilkan "Diblokir kebijakan keamanan (CSP): ..." dan konsol mencatat arahan yang dilanggar.

## Deploy

- Repo publik `masojie/nada-master`. Vercel project `nada-master` (alamat produksi https://nada-master.vercel.app), build `node build.mjs`, output `dist`, tanpa framework.
- Integrasi Git Vercel aktif: setiap merge ke `main` otomatis membuat deployment production, dan setiap PR mendapat preview. Setelah merge, cek bahwa deployment berstatus READY dan commit yang terpasang adalah yang dimaksud.

## Definition of done

- [ ] `npm test` hijau, jumlah todo tidak bertambah tanpa alasan tertulis
- [ ] `npm run build` sukses
- [ ] Ada tes yang gagal bila perubahan ini dibatalkan (untuk fitur baru atau perbaikan bug)
- [ ] README dan dokumen ini diperbarui bila perilaku atau perintah berubah
- [ ] Laporan ke pemilik jujur: apa yang diuji, apa yang belum, apa yang masih TODO

## Backlog audit (urut prioritas)

Selesai di audit 2026-11-19 (lihat `docs/AUDIT-2026-11-19.md`): silang-cek true peak (meter dan limiter kini 48 tap, selisih dengan estimator independen <= 0,1 dB) dan alarm palsu QC pada input sunyi. Keduanya kini `t.ok()`.

3. **Kasus tepi dan memori.** Lagu panjang (10 menit atau lebih) di HP, MP3 decode, file 24-bit 192 kHz.
4. **Kalibrasi preset** dengan audio referensi nyata dan perbandingan telinga.
5. **Preview cepat.** Render potongan 15 sampai 20 detik saat genre atau style diganti, hasil penuh tetap lewat Re-master.
6. **Bundler.** Pertimbangkan esbuild bila bentuk import yang dibatasi mulai mengganggu.
7. **Lisensi.** Belum ada file LICENSE.

## Live preview (jalur cepat)
- `src/preview/preview-core.js` (DSP: Pre, EQ, kompresor, limiter; tanpa alokasi di process), `preview-params.js` (settings -> parameter), `preview-opts.js` (gain/ambang dari laporan render atau taksiran), `preview-worklet.js` (AudioWorklet, dibundel jadi teks `worklet-src` oleh build.mjs, dimuat dari Blob).
- Hanya perkiraan untuk didengar saat mengatur. MASTER/EXPORT tetap memakai `src/engine` (tidak diubah). Tes: `tests/t_preview.mjs`, `tests/t_preview_opts.mjs`.
