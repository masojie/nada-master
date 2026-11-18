// tests/lib/build.mjs - akar repo dan pemanggil build.mjs untuk tes yang memeriksa hasil build.
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DIST = path.join(ROOT, 'dist');

// Menjalankan "node build.mjs" persis seperti Vercel lalu membaca hasilnya.
export function buildDist() {
  const log = execFileSync(process.execPath, ['build.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 }).trim();
  return {
    log,
    html: fs.readFileSync(path.join(DIST, 'index.html'), 'utf8'),
    worker: fs.readFileSync(path.join(DIST, 'engine-worker.js'), 'utf8'),
  };
}
