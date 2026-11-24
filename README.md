# Lintang Audio

Workstation mastering audio berbasis browser. Prosesnya deterministik (rule-based DSP), tanpa AI: file dan setting yang sama selalu menghasilkan hasil yang sama.

Demo: https://nada-master.vercel.app

## Ringkasan

- Semua proses berjalan di browser kamu lewat Web Worker. File audio tidak diunggah ke server mana pun.
- Vercel hanya menyajikan file web. Kecepatan render bergantung pada perangkat yang dipakai (contoh: lagu 3:17 selesai sekitar 53 detik di sebuah HP Android).
- Cocok untuk membandingkan hasil master dengan file aslinya secara adil (A/B dengan loudness yang dicocokkan).

## Fitur

**Input**
- WAV, FLAC, AIFF, MP3
- 44.1 sampai 192 kHz, mono atau stereo

**Preset genre (68 genre dalam 6 kategori)**
- Pop & Vocal (12)
- Rock & Alternative (12)
- Electronic & Dance (12)
- Hip-Hop & Urban (10)
- Indonesian Music (10), termasuk Dangdut, Dangdut Koplo, Dangdut Klasik, Pop Jawa, dan Pop Akustik Indonesia
- Acoustic & Other (12)

**Voicing (6)**: Balanced, Vocal Clarity, Warm Analog, Punchy, Bright, Smooth

**Mastering style (5)**
- Transparent: pemrosesan minimal, menjaga mix asli
- Warm Analog: harmonik halus, high-end lembut
- Modern Commercial: rapi dan kompetitif
- Loud: loudness maksimal dengan kontrol distorsi
- Dynamic: menjaga transien dan dinamika alami

**Target loudness**: Auto (dari genre dan style), Spotify -14 LUFS, Apple Music -16 LUFS, YouTube -14 LUFS, Commercial -9.5 LUFS, Dynamic -16 LUFS, atau Custom (-30 sampai -6 LUFS)

**True-peak ceiling**: -1.0, -1.5, atau -2.0 dBTP

**Adaptive correction**: koreksi berbasis aturan dari hasil analisis file (opsional, aktif secara default)

**Analisis dan metering**: momentary, short-term, dan integrated LUFS, true peak, loudness range, peak-to-loudness, phase correlation, limiter gain reduction, spectrum analyzer, waveform dengan kurva gain reduction, dan QC

**Player A/B**: Original vs Mastered, loop, dan opsi Loudness-matched A/B

**Mode Simple dan Advanced**: Simple cukup memilih preset lalu Re-master. Advanced menampilkan seluruh rantai proses yang bisa diubah dan di-bypass per tahap.

**Tampilan (Lintang Audio)**: tema krem atau gelap (tombol di header, pilihan diingat di browser), font Archivo dan JetBrains Mono ditanam langsung di `dist/index.html` lewat `build.mjs` dari `src/ui/fonts/` (lisensi OFL ada di folder yang sama), sehingga tetap tanpa CDN atau permintaan jaringan. Advanced berupa 12 unit rak: LCD, knob dengan tombol +/-, fader, switch bypass. Kontrol yang pada kondisi tertentu tidak berpengaruh (misalnya Q pada HP 24 dB) dibuat redup dan nonaktif. Kode ada di `src/ui/rack.js` dan `src/ui/genre-view.js`.

**Rantai proses (sesuai tampilan Advanced)**
1. Pre-processing
2. Corrective EQ (minimum atau linear phase)
3. Dynamic EQ
4. Bus compression
5. Multiband compression
6. Saturation & harmonics
7. Stereo image
8. Tonal enhancement
9. Clipper
10. True-peak limiter
11. Loudness management
12. Adaptive correction

**Export**
- Format: WAV 24-bit, WAV 16-bit, WAV 32-bit float, FLAC 24-bit, FLAC 16-bit
- Sample rate: Original, 44100, 48000, 88200, 96000
- Dither: Auto (TPDF atau noise-shaped), TPDF flat, Noise-shaped (16-bit), None
- Tombol Export & verify memeriksa file hasil ekspor

## Cara pakai

1. Upload file audio.
2. Pilih Category, Genre, Voicing, Mastering style, Loudness target, dan True-peak ceiling.
3. Tekan **Master** (setelah render pertama tombolnya menjadi **Re-master**).
4. Bandingkan lewat tombol **A Original** dan **B Mastered**. Biarkan Loudness-matched A/B tercentang supaya perbandingannya adil.
5. Kalau belum cocok, ganti style atau setting, lalu tekan Re-master lagi.
6. Pilih format ekspor lalu tekan **Export & verify**.

Catatan penting: mengganti genre, voicing, style, atau target hanya memperbarui rencana setting. Suara baru berubah setelah tombol Master atau Re-master ditekan, karena seluruh lagu dirender ulang. Perubahan manual di tab Advanced juga baru berlaku setelah Re-master.

## Menjalankan sendiri

Tidak ada dependency. Butuh Node.js (diuji di Node 22).

```bash
git clone https://github.com/masojie/nada-master.git
cd nada-master
node build.mjs
```

Hasil build ada di folder `dist/`:
- `dist/index.html`: aplikasi dalam satu file (worker sudah ikut tertanam)
- `dist/engine-worker.js`: worker terpisah

Sajikan lewat server lokal lalu buka alamatnya di browser, misalnya:

```bash
python -m http.server -d dist 8080
# atau
npx serve dist
```

Di Android (Termux): `pkg install nodejs`, lalu langkah yang sama.

Tanpa Git, unduh lewat tombol Code lalu Download ZIP di halaman GitHub, ekstrak, dan jalankan `node build.mjs`.

## Deploy ke Vercel

Konfigurasi ada di `vercel.json`: build `node build.mjs`, output `dist`, install `echo no-deps`, tanpa framework.

## Struktur proyek

```
src/engine/   mesin DSP: biquad, FFT, resample, oversample, limiter, loudness (BS.1770),
              analisis, modul proses, settings resolver, rantai render, QC, codec, exporter
src/presets/  katalog 68 genre, arketipe, voicing, validator
src/ui/       antarmuka (index.html, app.js, styles.css)
src/worker.js worker DSP yang dipanggil UI
build.mjs     bundler tanpa dependency
tests/        suite tes (t_*.mjs), lib/ berisi harness dan generator sinyal sintetis
AGENTS.md     aturan kerja dan panduan untuk AI dan developer
```

## Tes

```bash
npm test             # semua tes, sekitar 1,5 menit
npm run test:fast    # tanpa tes lambat, sekitar 5 detik
```

Semua tes memakai sinyal sintetis yang deterministik, jadi tidak butuh file audio dari luar. Yang diuji: unit DSP, katalog preset, codec dan meter, chain end-to-end (true peak, loudness, determinisme), export semua format dan sample rate, kasus tepi (sunyi, mono, sangat pendek, clipping, 192 kHz), hasil build, bundel worker yang dijalankan lewat protokol pesan yang sama dengan UI, dan pagar sintaks untuk bundler. CI di GitHub Actions menjalankan semuanya di setiap commit. Panduan lengkap untuk menulis tes ada di `AGENTS.md`.

## Batasan yang perlu diketahui

- Semua angka preset adalah titik awal yang terdokumentasi, belum dikalibrasi dengan audio referensi. Selalu cek dengan telinga, idealnya lewat headphone dan speaker.
- Belum ada preview real-time. Setiap perubahan setting perlu render ulang penuh.
- Waktu render naik seiring panjang lagu dan kekuatan perangkat.
- Belum ada mode offline atau PWA (tidak ada service worker maupun manifest).
- Proyek tanpa lisensi yang dinyatakan di repo ini. Tambahkan file LICENSE kalau ingin dibagikan ulang.
