import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const dist = 'dist',
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const urls = [
  '/index.html',
  '/architecture.html',
  '/favicon.png',
  '/profile.png',
  '/capture.webmanifest',
  '/capture-store.js',
  '/capture-icons/icon-192.png',
  '/capture-icons/icon-512.png',
];
async function walk(dir) {
  for (const entry of await readdir(join(dist, dir), { withFileTypes: true })) {
    const name = dir + '/' + entry.name;
    if (entry.isDirectory()) await walk(name);
    else urls.push('/' + name);
  }
}
await walk('assets');
urls.sort();
const assets = await Promise.all(
  urls.map(async (url) => ({ url, hash: hash(await readFile(join(dist, url.slice(1)))) })),
);
const workerTemplate = await readFile('public/capture-worker.js', 'utf8');
const appVersion = hash(JSON.stringify(assets) + workerTemplate);
await writeFile(
  join(dist, 'capture-worker.js'),
  workerTemplate.replace('__LENEU_OFFLINE_VERSION__', appVersion),
);
// Cache lazy editor chunks too, without importing/evaluating them in the home bundle.
await writeFile(
  join(dist, 'offline-manifest.json'),
  JSON.stringify({
    appVersion,
    assets,
    editorAssets: assets.filter((item) => item.url.startsWith('/assets/')),
  }),
);
console.log(`Offline manifest: ${assets.length} assets, ${appVersion.slice(0, 12)}`);
