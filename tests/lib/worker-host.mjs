// tests/lib/worker-host.mjs
// Menjalankan bundel worker HASIL BUILD (dist/engine-worker.js) di Node dengan objek "self" palsu.
// Dengan begini yang diuji adalah kode yang benar-benar dikirim ke browser, bukan modul sumbernya,
// jadi kesalahan bundler (import hilang, urutan modul salah) ikut tertangkap.
export function createWorkerHost(code) {
  const messages = [];
  const self = { postMessage: (m) => { messages.push(m); }, onmessage: null };
  new Function('self', code)(self);
  if (typeof self.onmessage !== 'function') throw new Error('worker tidak memasang self.onmessage');
  return {
    messages,
    // Mengirim satu pesan ke worker lalu mengembalikan pesan yang diposting sebagai balasan (sinkron).
    send(m) {
      const from = messages.length;
      self.onmessage({ data: m });
      return messages.slice(from);
    },
  };
}
