// sel-info.js - penjelasan di pop-up pilihan (sheet). Setiap teks mengacu ke perilaku mesin yang nyata:
// resample.js (sinc Kaiser, redaman ~95 dB), dither.js (resolveDither), exporter.js (limiter pengaman + verifikasi bit-exact),
// oversample.js (tpFactorFor), settings.js (modeTarget, LOUDNESS_TARGETS), genres.js (VOICINGS). Dicocokkan ke mesin oleh tests/t_sel_info.mjs.
import { GENRES, CATEGORIES, VOICINGS, LOUDNESS_TARGETS } from '../engine/settings.js';

const ABOUT = {
  cat: 'Memilih kelompok genre: ' + GENRES.length + ' genre dalam ' + CATEGORIES.length + ' kategori. Genre yang dipilih menentukan kurva spektrum target, preset EQ, kompresi, dan limiter, serta target loudness awal.',
  voicing: 'Voicing menambah penyesuaian tipis di atas preset genre (tone, kompresi, saturasi, gaya limiter) tanpa mengganti genre-nya.',
  loud: 'Target integrated loudness (LUFS) yang dicari mesin lewat penguatan dan limiter. Bila limiter harus menekan lebih dari batas gaya mastering (1,5 sampai 6 LU) dan Preserve dynamics aktif, mesin mundur ke penguatan yang masih dalam batas itu, jadi hasil bisa sedikit di bawah target.',
  ceil: 'Batas puncak tertinggi hasil master, diukur sebagai true peak: interpolasi 4× (2× untuk sample rate 120 kHz ke atas). Limiter menahan sinyal di bawah angka ini; QC lulus bila true peak tidak melewati ceiling lebih dari 0,05 dB.',
  fmt: 'Format file hasil export. Setelah ditulis, mesin membaca file itu kembali dan membandingkannya sampel demi sampel (harus bit-exact), lalu mengecek format, panjang, true peak, dan clipping integer.',
  sr: 'Sample rate file export. Bila berbeda dari file asli, audio di-resample dengan filter sinc berjendela Kaiser (redaman stopband sekitar 95 dB), lalu dilewatkan limiter pengaman true-peak sebesar ceiling karena resampling bisa menggeser puncak. Menaikkan sample rate tidak menambah detail baru.',
  dither: 'Dither mengacak galat pembulatan saat audio dipangkas ke 16 atau 24-bit, supaya distorsi kuantisasi berubah jadi desis halus. WAV 32-bit float tidak dibulatkan, jadi dither tidak berlaku.'
};
const LOUD = {
  auto: 'Dari target genre lalu disesuaikan gaya: Transparent tidak lebih keras dari −14, Warm −0,5 dB, Modern tetap, Loud +1,5 dB (tidak lebih keras dari −7,5), Dynamic −3 dB (dibatasi −14 sampai −18).',
  spotify: 'Target tetap; cocok bila lagu akan dirilis ke Spotify.',
  apple: 'Target tetap; lebih pelan dari Spotify, limiter bekerja lebih ringan.',
  youtube: 'Target tetap; angkanya sama dengan Spotify.',
  commercial: 'Target tetap; sangat keras, limiter harus bekerja jauh lebih berat.',
  dynamic: 'Target tetap, setara Apple Music; untuk hasil yang menjaga dinamika.',
  custom: 'Angka sendiri (−30 sampai −6 LUFS) lewat kolom Custom target yang muncul.'
};
const CEIL = {
  '-1': 'Bawaan mesin dan acuan umum untuk streaming.',
  '-1.5': 'Ruang puncak lebih lega; limiter sedikit lebih berat pada target loudness yang sama.',
  '-2': 'Paling lega; limiter paling berat pada target loudness yang sama.'
};
const FMT = {
  'wav:24': 'WAV tanpa kompresi, 24-bit integer. Pilihan umum untuk master; memakai dither.',
  'wav:16': 'WAV 16-bit integer (standar CD); memakai dither, noise-shaped bila Auto di 44,1 atau 48 kHz.',
  'wav:32': 'WAV 32-bit float: tidak ada pembulatan, jadi tanpa dither dan tanpa risiko clipping integer.',
  'flac:24': 'FLAC lossless 24-bit: isinya sama dengan WAV 24-bit tapi lebih kecil; CRC ikut diperiksa.',
  'flac:16': 'FLAC lossless 16-bit: isinya sama dengan WAV 16-bit tapi lebih kecil; CRC ikut diperiksa.'
};
const SR = {
  '0': 'Tanpa resampling; memakai sample rate file asli. Jalur paling bersih.',
  '44100': 'Resample ke 44,1 kHz (standar CD).',
  '48000': 'Resample ke 48 kHz (standar video dan banyak platform streaming).',
  '88200': 'Resample ke 88,2 kHz (kelipatan 2× dari 44,1 kHz). File lebih besar.',
  '96000': 'Resample ke 96 kHz (kelipatan 2× dari 48 kHz). File lebih besar.'
};
const DITHER = {
  auto: 'Mesin memilih: noise-shaped untuk 16-bit di 44,1 atau 48 kHz, selain itu TPDF; 32-bit float tanpa dither.',
  tpdf: 'TPDF flat: derau segitiga ±1 LSB dengan spektrum rata. Berlaku untuk semua format integer.',
  shaped: 'Filter Lipshitz 5-tap menggeser derau ke frekuensi yang kurang terdengar. Hanya aktif untuk 16-bit di 44,1 atau 48 kHz; selain itu otomatis jadi TPDF.',
  none: 'Dibulatkan langsung tanpa dither. Bagian pelan bisa terdengar kasar karena distorsi kuantisasi.'
};
export function selAbout(id) { return ABOUT[id] || ''; }
export function selOptionDesc(id, value) {
  const v = String(value);
  if (id === 'cat') { const l = GENRES.filter((g) => g.categoryIndex === +v); return l.length ? l.length + ' genre: ' + l.slice(0, 3).map((g) => g.name).join(', ') + ', …' : ''; }
  if (id === 'voicing') return VOICINGS[v] ? VOICINGS[v].desc : '';
  if (id === 'loud') return LOUDNESS_TARGETS.some((t) => t.id === v) ? LOUD[v] || '' : '';
  const map = { ceil: CEIL, fmt: FMT, sr: SR, dither: DITHER }[id];
  return map && map[v] ? map[v] : '';
}
