# RFC: jalur preview cepat untuk mode Advanced

Status: USULAN, untuk didiskusikan. PR ini hanya berisi dokumen ini, belum ada kode dan tidak mengubah perilaku aplikasi.

## 1. Masalah

Di mode Advanced, pengguna ingin menggeser knob, mengganti genre, atau menyalakan bypass sambil musik diputar, lalu langsung mendengar bedanya. Mesin sekarang tidak bisa melakukan itu: ia merender seluruh lagu secara offline, lalu hasilnya diputar. Setiap perubahan harus menunggu RE-MASTER penuh.

## 2. Angka yang diukur

Waktu render mesin yang ada (`renderMaster`, 12 tahap, preset Pop Indonesia, mode modern, adaptive aktif):

| Lingkungan | Lagu | Waktu render | Rasio terhadap durasi |
|---|---|---|---|
| Node 22, 2 vCPU (lingkungan kerja penulis), diukur | sinyal uji stereo 30 dtk, 44,1 kHz | 3,4 dtk | 0,114x |
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

### 2.1 Tes kompatibilitas di dalam Claude (HP pengguna, 2026-11-23)

Halaman tes kecil dijalankan pengguna di HP-nya, di dalam penampil artifact Claude (Chrome 157 di Android, 8 inti, `deviceMemory` melapor 8 GB yang merupakan batas atas yang dilaporkan browser, `crossOriginIsolated=false`, `SharedArrayBuffer` tidak tersedia). Hasil:

| Tes | Hasil |
|---|---|
| Web Worker dari Blob | LULUS |
| Beban CPU: 8 biquad x 2 kanal per blok 128 sampel, 5000 blok, di Worker | LULUS, 0,0200 ms/blok, sekitar 0,7 persen dari jatah blok 2,90 ms pada 44,1 kHz |
| WebAssembly (kompilasi modul, deteksi SIMD) | LULUS, SIMD tersedia |
| AudioContext | LULUS, 48 kHz, baseLatency 5,3 ms |
| AudioWorklet dari Blob (`addModule`) | LULUS, 512 blok diproses dalam 1,36 dtk audio, 48094 sampel per detik |

Pembanding: pada lingkungan Node/Chromium tanpa tampilan milik penulis, tes CPU yang sama memakai 0,0105 ms/blok. HP pengguna sekitar 2x lebih lambat per inti, konsisten dengan rasio render penuh pada bagian 2 (0,27x berbanding 0,114x, sekitar 2,4x).

Implikasi:

- `AudioWorklet` dimuat dari Blob dan berjalan di dalam Claude pada perangkat ini, sehingga jalur preview real-time layak secara teknis di sana dan tidak perlu dipindah ke hosting lain.
- `SharedArrayBuffer` tidak tersedia (halaman tidak `crossOriginIsolated`). Rancangan tidak boleh bergantung padanya; data ke worklet lewat `postMessage` dan buffer yang dipindahkan.
- WASM dengan SIMD tersedia, jadi fase 2 (Rust) tidak terhalang oleh dukungan browser.
- Catatan batas: tes hanya menguji satu perangkat. `file://` membuat AudioWorklet dari Blob gagal karena origin buram; ini hanya berlaku untuk membuka file langsung dari penyimpanan, bukan untuk Claude atau Vercel.

### 2.2 Perkiraan kebutuhan perangkat

Angka di bagian ini PERKIRAAN dari satu perangkat dan hitungan kasar. Belum diukur pada perangkat lain dan belum diukur pada rantai preview yang sebenarnya.

- Penentu utama preview real-time adalah kecepatan satu inti CPU: setiap blok 128 sampel pada 44,1 kHz harus selesai dalam sekitar 2,9 ms. Jumlah inti dan jumlah RAM tidak menentukan hal ini.
- Pada HP pengguna, 16 biquad per blok memakai 0,7 persen jatah. Rantai preview 4 tahap (Pre, EQ, kompresor, limiter sederhana) lebih berat tetapi diperkirakan masih jauh di bawah jatah pada perangkat sekelas ini. Perangkat yang sampai sekitar 3x sampai 4x lebih lambat kemungkinan masih cukup. Harus dibuktikan oleh prototipe, jangan dianggap fakta.
- Memori: satu salinan lagu stereo 4 menit pada 48 kHz dalam float32 sekitar 92 MB. Aplikasi menyimpan beberapa salinan (sumber, hasil master, salinan untuk pemutar). Perkiraan puncak sekitar 400 sampai 600 MB untuk lagu 4 menit. Pedoman kasar: RAM 4 GB ke atas aman; 3 GB cukup untuk lagu biasa; 2 GB berisiko untuk lagu panjang. Perlu diukur nyata (pemakaian memori saat memuat, MASTER, dan preview).

## 3. Usulan: dua jalur

**Jalur akurat (sudah ada, tidak diubah).** Mesin `src/engine`, offline dan deterministik. Dipakai untuk MASTER, angka loudness, true-peak, tabel analisis, QC, dan EXPORT. Tes bit-identik dan tes audit tidak disentuh.

**Jalur cepat (baru).** Hanya untuk mendengar saat mengatur. Memproses audio saat diputar, dengan pengaturan yang sama persis dengan yang akan dipakai jalur akurat (objek `settings` yang sama). Hasilnya perkiraan, ditandai "PREVIEW (perkiraan)" di UI. Tidak dipakai untuk export atau angka meter hasil.

Pengguna yang puas dengan suaranya menekan MASTER; jalur akurat memakai pengaturan yang sama dan menghasilkan file final.

## 4. Rancangan jalur cepat

- Berjalan di `AudioWorklet`, memproses blok 128 sampel. Parameter dikirim lewat `port.postMessage` dari objek `settings` (nilai yang sama dengan yang diedit di `rack.js`).
- Audio sumber tetap PCM di memori (sudah ada di `S.pcm`), diumpankan ke worklet atau diputar dari buffer sumber yang dilewatkan ke node worklet.
- Perubahan parameter dihaluskan (smoothing) supaya tidak ada klik.
- Tanpa jaringan: modul worklet dimuat dari Blob yang ditanam di `dist/index.html`, sama seperti worker mesin sekarang. Terbukti jalan di Claude pada perangkat uji (bagian 2.1). CSP di `vercel.json` saat ini tidak membatasi `worker-src` atau `script-src`; tetap perlu diuji di hosting Vercel sebelum dianggap beres.
- Tahap yang masuk preview (berurutan): Pre, EQ, kompresor bus, limiter sederhana (tanpa true-peak oversampling penuh). Tahap lain (Dynamic EQ, multiband, saturasi, stereo, tone, clipper) ditambahkan bertahap sesuai hasil ukur beban.
- Penyederhanaan yang disengaja: oversampling dikurangi atau dimatikan, limiter tanpa pencarian loudness iteratif, loudness target tidak dicari dari seluruh lagu (memakai gain dari render penuh terakhir bila ada).

### 4.1 Anti patah-patah

Web mastering lain sering terdengar patah-patah. Penyebab umum dan penangkal yang diusulkan:

| Penyebab | Penangkal |
|---|---|
| Pemrosesan di thread utama bersama tampilan, sehingga gambar waveform atau layar yang macet ikut memutus suara | Seluruh DSP preview di `AudioWorklet` (thread audio terpisah). Tampilan tidak boleh memengaruhi audio |
| DSP terlalu berat untuk satu blok, sehingga telat | Hanya tahap ringan di preview; tanpa oversampling berat; indikator beban CPU; preview dimatikan otomatis dengan pesan jelas bila mendekati batas (tidak dibiarkan terus putus-putus) |
| Jeda garbage collection di tengah audio | Semua buffer dialokasikan sekali di awal; tanpa membuat objek, array, atau closure baru di dalam `process()` |
| Klik saat parameter berubah | Nilai parameter dihaluskan (smoothing), koefisien filter diinterpolasi, tidak melompat |
| Merender ulang seluruh lagu tiap perubahan | Jalur cepat memproses langsung saat diputar |
| Perangkat panas lalu CPU diturunkan; tab di latar belakang | Tidak bisa dicegah sepenuhnya; dideteksi dan dilaporkan, preview dihentikan secara terkendali |
| Jalur Bluetooth | Di luar kendali aplikasi; dicatat sebagai batasan yang diketahui |

Pengukuran, bukan hanya telinga: prototipe memuat penghitung gangguan (selisih antara blok yang seharusnya diproses berdasarkan `currentTime` dan blok yang benar-benar diproses) dan indikator beban CPU yang tampil di UI mode Advanced. Anggaran awal yang diusulkan: rata-rata di bawah 50 persen dari durasi blok, tanpa blok terlewat dalam uji 60 detik pada perangkat target.

Risiko sisa yang jujur: pada perangkat yang jauh lebih lemah atau saat panas, gangguan tetap mungkin terjadi. Pengaman otomatis di atas dimaksudkan agar kegagalannya terkendali, bukan menjamin nol gangguan.

## 5. Implementasi: JS dulu, Rust/WASM bila perlu

Fase 1: prototipe `AudioWorklet` dalam JavaScript, 4 tahap. Tanpa toolchain tambahan, sejalan dengan aturan repo (tanpa dependensi, satu `dist/index.html`). Ukur beban CPU, memori, dan gangguan di HP target.

Fase 2 (hanya bila fase 1 tidak cukup ringan): pindahkan loop DSP terberat ke Rust yang dikompilasi ke WASM. Kompilasi dilakukan di GitHub Actions (sesuai aturan kerja berat lewat CI), file `.wasm` hasil build di-commit atau dilampirkan sehingga build harian tetap `node build.mjs` tanpa Rust. Catatan: target `wasm32-unknown-unknown` tidak bisa dipasang di lingkungan kerja yang dipakai untuk menulis RFC ini, jadi kompilasi harus lewat CI atau mesin pengguna. WASM dan SIMD terbukti tersedia di perangkat uji (bagian 2.1).

Rust/WASM bukan tulis ulang mesin: ia hanya mengisi jalur cepat. Mesin JS tetap acuan.

## 6. Pengujian

Jalur cepat tidak dites bit-identik. Usulan tes perbandingan terhadap `renderMaster` pada sinyal uji tetap (nada, noise berwarna, campuran dinamis), dengan tahap yang sama aktif:

- selisih respons spektrum per oktaf dalam batas yang ditetapkan (usulan awal 1 dB, dikalibrasi dari hasil pertama, bukan ditebak),
- selisih loudness terukur dalam batas yang ditetapkan (usulan awal 1 LU sebelum tahap loudness),
- tidak ada NaN, klik, atau lonjakan saat parameter berubah,
- beban CPU per blok di bawah anggaran (usulan: di bawah 50 persen dari durasi blok pada HP target) dan nol blok terlewat pada uji 60 detik.

Batas angka di atas adalah usulan awal; nilai finalnya harus ditentukan dari pengukuran dan disetujui, tidak boleh dilonggarkan diam-diam agar tes lulus.

## 7. Tidak berubah

- Mesin `src/engine/*`, hasil render, export, dan seluruh tes yang ada.
- Privasi: audio tidak keluar dari perangkat, tanpa jaringan.
- Tanpa dependensi npm.

## 8. Risiko

- Preview dan master terdengar berbeda (terutama kerapatan limiter dan loudness akhir). Mitigasi: penanda "perkiraan", tes toleransi, RE-MASTER tetap acuan.
- Beban CPU dan baterai di HP: preview hanya aktif saat saklar dinyalakan.
- Hasil tes kompatibilitas baru dari satu perangkat. Perangkat lain, versi browser lain, atau lingkungan hosting lain (Vercel, dengan CSP-nya) perlu diuji.
- Dua jalur DSP berarti dua tempat memelihara logika yang sama. Mitigasi: tes perbandingan otomatis.

## 9. Pertanyaan untuk didiskusikan

1. Apakah preview yang berupa perkiraan dapat diterima, atau harus lebih dekat lagi dengan master?
2. Tahap mana yang paling penting untuk didengar langsung (usulan urutan: EQ, kompresor, limiter, saturasi, stereo)?
3. Perangkat target minimum dan anggaran CPU yang dianggap wajar (usulan awal di bagian 2.2 dan 4.1)?
4. Apakah saklar "Live preview" (otomatis) atau tombol "Preview" (sekali tekan) yang lebih disukai?
5. Bila fase 2 diperlukan: kompilasi Rust di CI dengan `.wasm` di-commit, atau cara lain?

## 10. Rencana bertahap (bila disetujui)

1. Prototipe worklet JS 4 tahap, dengan indikator beban CPU dan penghitung gangguan, diukur di HP target.
2. Tes perbandingan terhadap `renderMaster`.
3. Integrasi UI: penanda PREVIEW, saklar, sinkron dengan posisi putar, pengaman otomatis.
4. Evaluasi: lanjut JS, atau fase 2 Rust/WASM.
