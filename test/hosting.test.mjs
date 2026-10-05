import { hostname } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHostingStore } from '../server/hosting/store.mjs';
import { serveHostedSite } from '../server/hosting/http.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'anotar-hosting-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, 'source');
  await mkdir(join(source, 'assets'), { recursive: true });
  await writeFile(
    join(source, 'index.html'),
    '<link rel="stylesheet" href="assets/style.css"><h1>Site</h1>',
  );
  await writeFile(join(source, 'assets/style.css'), 'h1{color:red}');
  await writeFile(join(source, 'secret.pdf'), 'excluded');
  await writeFile(join(source, '.env'), 'private');
  return { source, store: createHostingStore(join(dir, 'sites')), dir };
}
test('imports static tree only, keeps source, refuses overwrite and stale state changes', async (t) => {
  const { store, source } = await fixture(t);
  const item = await store.importDirectory({ source, slug: 'math', name: '수학' });
  assert.equal(item.fileCount, 2);
  assert.equal(item.enabled, false);
  assert.equal(item.skipped, 2);
  assert.equal(store.list().items.length, 1);
  await assert.rejects(
    store.importDirectory({ source, slug: 'math', name: 'Other' }),
    (e) => e.status === 409,
  );
  const published = store.update('math', { enabled: true, expectedVersion: item.version });
  assert.equal(published.version, 2);
  assert.throws(
    () => store.update('math', { enabled: false, expectedVersion: 1 }),
    (e) => e.status === 409,
  );
  assert.equal(store.read('math').enabled, true);
});
test('omitted address generates distinct persistent routes for Korean and repeated names', async (t) => {
  const { store, source, dir } = await fixture(t);
  const first = await store.importDirectory({ source, name: '교토 여행' });
  const second = await store.importDirectory({ source, name: '교토 여행', slug: '' });
  const readable = await store.importDirectory({ source, name: 'My Project' });
  assert.match(first.slug, /^site-[a-f0-9]{12}$/);
  assert.match(second.slug, /^site-[a-f0-9]{12}$/);
  assert.match(readable.slug, /^my-project-[a-f0-9]{12}$/);
  assert.notEqual(first.slug, second.slug);
  assert.equal(first.enabled, false);
  store.update(first.slug, { name: '이름 변경', expectedVersion: first.version });
  assert.equal(createHostingStore(join(dir, 'sites')).read(first.slug).name, '이름 변경');
  assert.equal(store.list().items[0].slug, first.slug);
  await assert.rejects(
    store.importDirectory({ source, name: '잘못된 주소', slug: '../bad' }),
    (e) => e.status === 422,
  );
});
test('directory CLI registers a stopped site without requiring an address', async (t) => {
  const { store, source } = await fixture(t);
  const { stdout } = await promisify(execFile)(process.execPath, [
    'scripts/host-site.mjs',
    'import',
    source,
    '--name',
    '수동 등록',
    '--dir',
    store.root,
  ]);
  const item = JSON.parse(stdout);
  assert.match(item.slug, /^site-[a-f0-9]{12}$/);
  assert.equal(item.enabled, false);
  assert.equal(item.fileCount, 2);
  assert.equal(store.read(item.slug).name, '수동 등록');
});
test('rejects unsafe paths and excludes symlinks', async (t) => {
  const { store, source, dir } = await fixture(t);
  await writeFile(join(dir, 'outside.html'), 'secret');
  await symlink(join(dir, 'outside.html'), join(source, 'link.html'));
  const item = await store.importDirectory({ source, slug: 'safe', name: 'safe' });
  assert.equal(item.fileCount, 2);
  assert.equal(item.skipped, 3);
  await assert.rejects(
    store.importFiles({
      slug: 'bad',
      name: 'bad',
      files: [{ path: '../index.html', data: Buffer.from('x') }],
    }),
    (e) => e.status === 422,
  );
  await assert.rejects(
    store.importFiles({
      slug: 'bad',
      name: 'bad',
      files: [
        { path: 'index.html', data: Buffer.from('x') },
        { path: 'index.html', data: Buffer.from('y') },
      ],
    }),
    (e) => e.status === 422,
  );
  assert.equal(store.list().items.length, 1);
});
test('public server supplies only published manifest files with proper MIME, ETag and HEAD', async (t) => {
  const { store, source } = await fixture(t);
  const item = await store.importDirectory({ source, slug: 'math', name: 'math' });
  const server = createServer((req, res) => void serveHostedSite(req, res, store));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin + '/math/')).status, 404);
  store.update('math', { enabled: true, expectedVersion: item.version });
  let res = await fetch(origin + '/math/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const etag = res.headers.get('etag');
  assert.ok(etag);
  assert.equal(
    (await fetch(origin + '/math/', { headers: { 'If-None-Match': etag } })).status,
    304,
  );
  res = await fetch(origin + '/math/assets/style.css', { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/css/);
  assert.equal(await res.text(), '');
  for (const path of [
    '/math/secret.pdf',
    '/math/.env',
    '/math/link.html',
    '/math/%2e%2e%2fregistry.json',
    '/api/hosting',
    '/',
  ])
    assert.equal((await fetch(origin + path)).status, 404, path);
  assert.equal((await fetch(origin + '/math/', { method: 'POST' })).status, 405);
  store.update('math', { enabled: false, expectedVersion: 2 });
  assert.equal((await fetch(origin + '/math/')).status, 404);
});

test('public server refuses relocated bundle directory symlinks', async (t) => {
  const { store, source, dir } = await fixture(t);
  const item = await store.importDirectory({
    source,
    slug: 'escape',
    name: 'escape',
    enabled: true,
  });
  const bundle = join(store.root, 'bundles', item.id),
    outside = join(dir, 'outside');
  await rename(bundle, outside);
  await symlink(outside, bundle);
  const server = createServer((req, res) => void serveHostedSite(req, res, store));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/escape/`);
  assert.equal(res.status, 404);
});

test('stopped lock owner is reclaimed without removing a live writer', async (t) => {
  const { store, source } = await fixture(t);
  const item = await store.importDirectory({ source, slug: 'locked', name: 'locked' });
  const lock = join(store.root, '.lock');
  await mkdir(lock);
  await writeFile(
    join(lock, 'owner.json'),
    JSON.stringify({ token: 'stopped', pid: 2147483647, host: hostname() }),
  );
  assert.equal(
    store.update('locked', { enabled: true, expectedVersion: item.version }).enabled,
    true,
  );
  await mkdir(lock);
  await writeFile(
    join(lock, 'owner.json'),
    JSON.stringify({ token: 'live', pid: process.pid, host: hostname() }),
  );
  assert.throws(
    () => store.update('locked', { enabled: false, expectedVersion: 2 }),
    (e) => e.status === 409,
  );
});
test('public server rejects intermediate symlinks even within the bundle', async (t) => {
  const { store, source } = await fixture(t);
  const item = await store.importDirectory({
    source,
    slug: 'inside',
    name: 'inside',
    enabled: true,
  });
  const base = join(store.root, 'bundles', item.id);
  await rename(join(base, 'assets'), join(base, '.private'));
  await symlink(join(base, '.private'), join(base, 'assets'));
  const server = createServer((req, res) => void serveHostedSite(req, res, store));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  assert.equal(
    (await fetch(`http://127.0.0.1:${server.address().port}/inside/assets/style.css`)).status,
    404,
  );
});
