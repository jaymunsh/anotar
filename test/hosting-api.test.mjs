import { Readable } from 'node:stream';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHostingRoutes } from '../server/hosting/routes.mjs';

test('folder API preserves nested files, defaults to stopped, rejects bad paths and cleans failed uploads', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'anotar-sites-api-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const handle = createHostingRoutes({ directory: dir, origin: 'http://127.0.0.1:8792' });
  const server = createServer(
    (req, res) => void handle(req, res, new URL(req.url, 'http://localhost')),
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/api/hosting`;
  const form = (slug = 'sample', path = 'assets/app.js') => {
    const f = new FormData();
    f.append('name', 'Sample');
    f.append('slug', slug);
    f.append('entry', 'index.html');
    f.append('files', new Blob(['<h1>Site</h1>']), 'index.html');
    f.append('files', new Blob(['console.log("ok")']), path);
    return f;
  };
  let res = await fetch(base, { method: 'POST', body: form() });
  assert.equal(res.status, 201, await res.clone().text());
  const { item } = await res.json();
  assert.equal(item.fileCount, 2);
  assert.equal(item.enabled, false);
  res = await fetch(base + '/sample', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, expectedVersion: 1 }),
  });
  assert.equal(res.status, 200);
  assert.equal((await fetch(base, { method: 'POST', body: form() })).status, 409);
  assert.equal(
    (await fetch(base, { method: 'POST', body: form('bad', '../escape.js') })).status,
    422,
  );
  assert.equal(
    (
      await fetch(base + '/sample', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      })
    ).status,
    422,
  );
  assert.equal((await fetch(base)).status, 200);
  const automatic = form();
  automatic.delete('slug');
  automatic.set('name', '자동 주소');
  res = await fetch(base, { method: 'POST', body: automatic });
  assert.equal(res.status, 201, await res.clone().text());
  const automaticItem = (await res.json()).item;
  assert.match(automaticItem.slug, /^site-[a-f0-9]{12}$/);
  assert.ok((await (await fetch(base)).json()).items.some((s) => s.slug === automaticItem.slug));
  res = await fetch(base, { method: 'POST', body: form('korean', 'assets/한글.js') });
  assert.equal(res.status, 201);
  const registry = JSON.parse(await readFile(join(dir, 'registry.json'), 'utf8'));
  assert.ok(Object.hasOwn(registry.sites.find((s) => s.slug === 'korean').files, 'assets/한글.js'));

  const thousand = new FormData();
  thousand.append('name', 'Thousand');
  thousand.append('slug', 'thousand');
  thousand.append('entry', 'index.html');
  thousand.append('files', new Blob(['<h1>1000</h1>']), 'index.html');
  for (let i = 0; i < 999; i++) thousand.append('files', new Blob(['x']), `assets/f${i}.js`);
  res = await fetch(base, { method: 'POST', body: thousand });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).item.fileCount, 1000);
  const exact = form('exact', 'assets/large.js');
  exact.delete('files');
  exact.append('files', new Blob(['<h1>Exact</h1>']), 'index.html');
  exact.append('files', new Blob([Buffer.alloc(25 * 1024 * 1024, 120)]), 'assets/large.js');
  res = await fetch(base, { method: 'POST', body: exact });
  assert.equal(res.status, 201);
  const boundary = 'hosting-limit-test';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nRaw\r\n--${boundary}\r\nContent-Disposition: form-data; name="slug"\r\n\r\nraw\r\n--${boundary}\r\nContent-Disposition: form-data; name="entry"\r\n\r\nindex.html\r\n--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="index.html"\r\nContent-Type: text/html\r\n\r\nx\r\n--${boundary}--\r\n`;
  async function* oversized() {
    yield Buffer.from(head);
    const chunk = Buffer.alloc(1024 * 1024, 120);
    for (let i = 0; i < 60; i++) yield chunk;
  }
  res = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: Readable.from(oversized()),
    duplex: 'half',
  });
  assert.equal(res.status, 413);
  await res.text();
  assert.ok(
    !JSON.parse(await readFile(join(dir, 'registry.json'), 'utf8')).sites.some(
      (s) => s.slug === 'raw',
    ),
  );
  assert.ok(
    (await readdir(dir)).every(
      (name) => !name.startsWith('.incoming-') && !name.startsWith('.import-') && name !== '.lock',
    ),
  );
});
