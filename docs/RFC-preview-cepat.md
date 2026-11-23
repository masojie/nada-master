# RFC: jalur preview cepat untuk mode Advanced

Status: USULAN, untuk didiskusikan. PR ini hanya berisi dokumen ini, belum ada kode dan tidak mengubah perilaku aplikasi.

## 1. Masalah

Di mode Advanced, pengguna ingin menggeser knob, mengganti genre, atau menyalakan bypass sambil musik diputar, lalu langsung mendengar bedanya. Mesin sekarang tidak bisa melakukan itu: ia merender seluruh lagu secara offline, lalu hasilnya diputar. Setiap perubahan harus menunggu RE-MASTER penuh.

## 2. Angka yang diukur

Waktu render mesin yang ada (`renderMaster`, 12 tahap, preset Pop Indonesia, mode modern, adaptive aktif):

| Lingkungan | Lagu | Waktu render | Rasio terhadap durasi |
|---|---|---|---|
| Node 22, 2 vCPU (lingkungan kerja ini), diukur | sinyal uji stereo 30 dtk, 44,1 kHz | 3,4 dtk | 0,114x |
| HP pengguna (dilaporkan pengguna lewat layar aplikasi) | lagu stereo 3:57,9, 48 kHz | 65 dtk | sekitar 0,27x |

Rincian waktu per tahap pada lingkungan Node di atas (dihitung dari selisih waktu antar callback progress; angka perkiraan, sinyal uji bukan musik sungguhan):

| Tahap | ms (dari 3413 ms total) |
|---|---|
| pre | 31 |
| eq | 120 |
| dyneq | 425 |
| comp | 122 |
| mb | 537 |
| sat | 410 |
| stereo | 61 |
| tone | 31 |
| loud (clip, limiter, pencarian loudness beberapa pass) | 1119 |
| analisis akhir (loudness, true-peak, spektrum, QC) | sekitar 550 |
| persiapan | 7 |

Kesimpulan yang sah dari angka ini: render lebih cepat dari waktu putar (sekitar 3,5x sampai 9x), tetapi bukan untuk real-time per blok kecil, dan sepertiga sampai separuh waktu habis di pencarian loudness dan analisis akhir, yaitu bagian yang tidak diperlukan untuk sekadar mendengar perubahan knob. Angka di HP lain akan berbeda. Perlu diukur ulang di perangkat target sebelum keputusan implementasi.

## 3. Usulan: dua jalur

**Jalur akurat (sudah ada, tidak diubah).** Mesin `src/engine`, offline dan deterministik. Dipakai untuk MASTER, angka loudness, true-peak, tabel analisis, QC, dan EXPORT. Tes bit-identik dan tes audit tidak disentuh.

**Jalur cepat (baru).** Hanya untuk mendengar saat mengatur. Memproses audio saat diputar, dengan pengaturan yang sama persis dengan yang akan dipakai jalur akurat (objek `settings` yang sama). Hasilnya perkiraan, ditandai "PREVIEW (perkiraan)" di UI. Tidak dipakai untuk export atau angka meter hasil.

Pengguna yang puas dengan suaranya menekan MASTER; jalur akurat memakai pengaturan yang sama dan menghasilkan file final.

## 4. Rancangan jalur cepat

- Berjalan di `AudioWorklet`, memproses blok 128 sampel. Parameter dikirim lewat `port.postMessage` dari objek `settings` (nilai yang sama dengan yang diedit di `rack.js`).
- Audio sumber tetap PCM di memori (sudah ada di `S.pcm`), diumpankan ke worklet atau diputar dari buffer sumber yang dilewatkan ke node worklet.
- Perubahan parameter dihaluskan (smoothing) supaya tidak ada klik.
- Tanpa jaringan: modul worklet dimuat dari Blob yang ditanam di `dist/index.html`, sama seperti worker mesin sekarang. Perlu dipastikan CSP (`vercel.json`) mengizinkan; saat ini tidak ada `worker-src` atau `script-src` yang membatasi.
- Tahap yang masuk preview (berurutan): Pre, EQ, kompresor bus, limiter sederhana (tanpa true-peak oversampling penuh). Tahap lain (Dynamic EQ, multiband, saturasi, stereo, tone, clipper) ditambahkan bertahap sesuai hasil ukur beban.
- Penyederhanaan yang disengaja: oversampling dikurangi atau dimatikan, limiter tanpa pencarian loudness iteratif, loudness target tidak dicari dari seluruh lagu (memakai gain dari render penuh terakhir bila ada).

## 5. Implementasi: JS dulu, Rust/WASM bila perlu

Fase 1: prototipe `AudioWorklet` dalam JavaScript, 4 tahap. Tanpa toolchain tambahan, sejalan dengan aturan repo (tanpa dependensi, satu `dist/index.html`). Ukur beban CPU di HP target.

Fase 2 (hanya bila fase 1 tidak cukup ringan): pindahkan loop DSP terberat ke Rust yang dikompilasi ke WASM. Kompilasi dilakukan di GitHub Actions (sesuai aturan kerja berat lewat CI), file `.wasm` hasil build di-commit atau dilampirkan sehingga build harian tetap `node build.mjs` tanpa Rust. Catatan: target `wasm32-unknown-unknown` tidak bisa dipasang di lingkungan kerja yang dipakai untuk menulis RFC ini, jadi kompilasi harus lewat CI atau mesin pengguna.

Rust/WASM bukan tulis ulang mesin: ia hanya mengisi jalur cepat. Mesin JS tetap acuan.

## 6. Pengujian

Jalur cepat tidak dites bit-identik. Usulan tes perbandingan terhadap `renderMaster` pada sinyal uji tetap (nada, noise berwarna, campuran dinamis), dengan tahap yang sama aktif:

- selisih respons spektrum per oktaf dalam batas yang ditetapkan (usulan awal 1 dB, dikalibrasi dari hasil pertama, bukan ditebak),
- selisih loudness terukur dalam batas yang ditetapkan (usulan awal 1 LU sebelum tahap loudness),
- tidak ada NaN, klik, atau lonjakan saat parameter berubah,
- beban CPU per blok di bawah anggaran (usulan: di bawah 50 persen dari durasi blok pada HP target).

Batas angka di atas adalah usulan awal; nilai finalnya harus ditentukan dari pengukuran dan disetujui, tidak boleh dilonggarkan diam-diam agar tes lulus.

## 7. Tidak berubah

- Mesin `src/engine/*`, hasil render, export, dan seluruh tes yang ada.
- Privasi: audio tidak keluar dari perangkat, tanpa jaringan.
- Tanpa dependensi npm.

## 8. Risiko

- Preview dan master terdengar berbeda (terutama kerapatan limiter dan loudness akhir). Mitigasi: penanda "perkiraan", tes toleransi, RE-MASTER tetap acuan.
- Beban CPU dan baterai di HP: preview hanya aktif saat saklar dinyalakan.
- `AudioWorklet` dan Blob module bisa dibatasi lingkungan tertentu (misalnya halaman yang disematkan). Perlu diuji di lingkungan target sebelum fase 2.
- Dua jalur DSP berarti dua tempat memelihara logika yang sama. Mitigasi: tes perbandingan otomatis.

## 9. Pertanyaan untuk didiskusikan

1. Apakah preview yang berupa perkiraan dapat diterima, atau harus lebih dekat lagi dengan master?
2. Tahap mana yang paling penting untuk didengar langsung (usulan urutan: EQ, kompresor, limiter, saturasi, stereo)?
3. Perangkat target dan anggaran CPU yang dianggap wajar?
4. Apakah saklar "Live preview" (otomatis) atau tombol "Preview" (sekali tekan) yang lebih disukai?
5. Bila fase 2 diperlukan: kompilasi Rust di CI dengan `.wasm` di-commit, atau cara lain?

## 10. Rencana bertahap (bila disetujui)

1. Prototipe worklet JS 4 tahap dan pengukuran CPU di HP target.
2. Tes perbandingan terhadap `renderMaster`.
3. Integrasi UI: penanda PREVIEW, saklar, sinkron dengan posisi putar.
4. Evaluasi: lanjut JS, atau fase 2 Rust/WASM.
