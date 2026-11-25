// boot.js - didaftarkan inline di index.html oleh build.mjs. Memasang service worker dan menangani pembaruan otomatis.
// Aturan: versi baru aktif langsung. Jika belum ada lagu yang dimuat dan tidak sedang memproses, halaman otomatis
// memuat ulang. Jika ada lagu atau proses berjalan, muncul spanduk "Perbarui" supaya pekerjaan tidak hilang.
(function () {
  'use strict';
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  var sw = navigator.serviceWorker, hadController = !!sw.controller, reloading = false, bar = null;
  function idle() {
    var b = document.body, t = document.getElementById('time');
    return !!b && !!t && !b.classList.contains('busy') && /\/ 0:00\.0\s*$/.test(t.textContent || '');
  }
  function reloadNow() { if (reloading) return; reloading = true; location.reload(); }
  function banner() {
    if (bar) return;
    bar = document.createElement('div'); bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:1000;display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 12px;border:1.5px solid currentColor;border-radius:10px;background:#17171A;color:#EDE8DC;font:600 12px JetBrains Mono,ui-monospace,monospace';
    var t = document.createElement('span'); t.textContent = 'Versi baru siap. Perbarui setelah pekerjaanmu selesai.';
    var b = document.createElement('button'); b.textContent = 'PERBARUI'; b.style.cssText = 'min-height:40px;padding:0 14px;border:0;border-radius:8px;background:#FF5A1F;color:#17171A;font:900 12px inherit;cursor:pointer';
    b.onclick = reloadNow; bar.append(t, b); document.body.appendChild(bar);
  }
  sw.addEventListener('controllerchange', function () {
    if (!hadController) { hadController = true; return; } // pemasangan pertama: tidak perlu memuat ulang
    if (idle()) reloadNow(); else banner();
  });
  sw.register('sw.js').then(function (reg) {
    var check = function () { try { reg.update().catch(function () {}); } catch (e) {} };
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
    window.addEventListener('online', check);
    setInterval(check, 15 * 60 * 1000);
    if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
  }).catch(function () {});
})();
