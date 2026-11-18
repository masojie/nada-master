// tests/lib/harness.mjs
// Harness tes minimal tanpa dependency. Dipakai oleh semua tes baru dan dibaca oleh tests/run-all.mjs.
//
// Format keluaran (satu baris per pernyataan):
//   PASS judul  info
//   FAIL judul  info      -> membuat proses keluar dengan kode 1
//   TODO judul  info      -> bug yang sudah diketahui dan belum diperbaiki, TIDAK menggagalkan tes
// Baris penutup: "SEMUA LULUS" atau "N GAGAL".
//
// Aturan pakai todo(): hanya untuk bug nyata yang sudah dicatat. Begitu bug diperbaiki, todo() akan
// mencetak "PASS (todo selesai)" sebagai pengingat untuk mengganti pemanggilannya menjadi ok().

const fmt = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(+v.toFixed(4)) : String(v));

export function suite(name) {
  const counts = { pass: 0, fail: 0, todo: 0 };
  const say = (s) => console.log(s);
  const line = (tag, title, info) => say(tag + ' ' + title + (info ? '  ' + info : ''));
  const t = {
    name,
    counts,
    section(title) { say('--- ' + title); },
    note(text) { say('NOTE ' + text); },
    ok(title, cond, info = '') {
      if (cond) { counts.pass++; line('PASS', title, info); } else { counts.fail++; line('FAIL', title, info); }
      return !!cond;
    },
    near(title, got, want, tol, unit = '') {
      const good = Number.isFinite(got) && Math.abs(got - want) <= tol;
      return t.ok(title, good, 'hasil=' + fmt(got) + unit + ' target=' + fmt(want) + unit + ' toleransi=' + tol + unit);
    },
    atMost(title, got, max, unit = '') {
      return t.ok(title, Number.isFinite(got) && got <= max, 'hasil=' + fmt(got) + unit + ' batas=' + fmt(max) + unit);
    },
    atLeast(title, got, min, unit = '') {
      return t.ok(title, Number.isFinite(got) && got >= min, 'hasil=' + fmt(got) + unit + ' batas=' + fmt(min) + unit);
    },
    throws(title, fn) {
      let threw = false;
      try { fn(); } catch { threw = true; }
      return t.ok(title, threw);
    },
    // Bug yang sudah diketahui. Gagal = TODO (tidak menggagalkan suite). Lulus = PASS dengan pengingat.
    todo(title, cond, info = '') {
      if (cond) { counts.pass++; line('PASS', title + ' (todo selesai, ganti ke ok())', info); } else { counts.todo++; line('TODO', title, info); }
      return !!cond;
    },
    // Menjalankan fn dan mencatat pelanggaran bila melempar error. Mengembalikan hasil fn atau undefined.
    attempt(title, fn) {
      try { const r = fn(); return r; } catch (e) { t.ok(title, false, 'error: ' + (e && e.message ? e.message : e)); return undefined; }
    },
    done() {
      say(counts.fail ? '\n' + counts.fail + ' GAGAL' + (counts.todo ? ', ' + counts.todo + ' todo' : '') : '\nSEMUA LULUS' + (counts.todo ? ' (' + counts.todo + ' todo)' : ''));
      process.exit(counts.fail ? 1 : 0);
    },
  };
  return t;
}
