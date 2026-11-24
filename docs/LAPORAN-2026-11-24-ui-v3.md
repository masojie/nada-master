# Laporan status: UI v3 (tab), metadata upload, tombol MASTER - 2026-11-24

Dokumen ini hanya catatan. PR ini tidak mengubah kode dan tidak mengubah perilaku aplikasi.

## Status singkat: SEBAGIAN SUDAH DIKERJAKAN, BELUM MASUK REPO

Pekerjaan UI v3 sudah jadi dan lulus tes, tetapi **kodenya belum ada di GitHub**. Sumbernya ada di `nada-master-terbaru-v3.zip` (dibuat 2026-11-23) dan hasil lanjutannya di `nada-master-v3b.zip` (2026-11-24), keduanya hanya ada di sesi chat Claude dan di HP pemilik repo.

Bukti bahwa `main` masih versi lama (dicek 2026-11-24, commit `19ea3ed`):
- `src/ui/` di `main` hanya berisi `app.js` (30 KB), `index.html`, `styles.css` (8 KB), `ui-util.js`.
- Di v3, `app.js` 51 KB dan `styles.css` 28 KB. File `rack.js`, `genre-view.js`, `explain.js`, `sel-info.js` dan folder `fonts/` hanya ada di v3.
- Semua cabang (`rebrand/lintang-audio`, `perf/limiter-buffers`, dst.) punya `app.js` yang sama dengan `main`.

Jadi jangan menimpa `main` dengan 4 file saja: perubahan di bawah menempel di atas v3 penuh.

## Yang sudah dikerjakan di atas v3 (2026-11-24)

1. Tab **Upload**: setelah upload tampil tabel metadata lengkap (nama, ukuran, format, bit depth, sample rate, channel, durasi, jumlah sampel, bitrate rata-rata, LUFS, loudness range, true peak, sample peak, RMS, crest, PLR, clipping, korelasi dan lebar stereo, tanggal ubah) ditambah tag tersemat (ID3v2 / RIFF INFO / FLAC Vorbis / AIFF). File baru: `src/ui/meta.js`.
2. Tombol **MASTER** dipindah ke bawah waveform (kartu Player); kartu "3 Master" yang lama dihapus.
3. Garis **progress** diperbaiki: bar sebelumnya tidak punya warna (tidak terlihat). Sekarang oranye, ada persen, tombol berubah jadi "MASTERING... N%", dan bar merayap di tahap Limiter yang lama.

File yang berubah: `src/ui/index.html`, `src/ui/app.js`, `src/ui/styles.css`, `src/ui/meta.js` (baru). `dist/` ter-ignore, dibangun ulang oleh `node build.mjs`. Tes: 26 file lulus, 890 pernyataan.

## Belum dikerjakan / belum dicek

- Push v3 + perubahan di atas ke repo (belum ada branch atau PR-nya).
- Sebelum push: bandingkan `src/engine/` v3 dengan `main`, karena perbaikan yang masuk setelah v3 dibuat (mis. PR #8 `butterSections`) tidak boleh tertimpa.
- Uji di browser/HP dengan lagu sungguhan: tampilan metadata, bar progress, dan tag untuk MP3/WAV/FLAC.
- Pratinjau sebagai artefak Claude: worker dari blob mungkin diblokir; versi Vercel tetap acuan.

## Langkah push yang disarankan

Buat branch dari `main`, salin isi `nada-master-v3b.zip` ke folder repo, jalankan `node tests/run-all.mjs`, cek `git diff --stat` (terutama `src/engine/`), commit, push, lalu buka PR.
