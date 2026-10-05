import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('search HTTP API validates literals, returns bounded active results and resets changed cursors', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'leneu-search-api-'));
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const server = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, AI_RUNNER_KIND: 'disabled', AI_RUNNER_URL: '', DATA_DIR: directory, PORT: String(port), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  t.after(async () => {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const search = (query = '', type = 'all', cursor = '') =>
    fetch(
      base +
        '/api/search?' +
        new URLSearchParams({ q: query, type, ...(cursor ? { cursor } : {}) }),
    );
  assert.equal((await search()).status, 200);
  const json = async (path, method, value) => {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  const memo = async (text, file = false) => {
    const form = new FormData();
    form.set('kind', file ? 'file' : 'note');
    form.set('text', text);
    if (file) form.append('files', new Blob(['바이트'], { type: 'text/plain' }), '탑승예약.md');
    return (await (await fetch(base + '/api/captures', { method: 'POST', body: form })).json())
      .item;
  };
  const record = await memo('교토검색 100% 원문', true);
  let page = (await json('/api/pages', 'POST', { title: '다른 제목' })).item;
  page = (
    await json('/api/pages/' + page.id, 'PUT', {
      ...page,
      expectedVersion: 1,
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: randomUUID(),
            type: 'paragraph',
            props: {},
            content: [{ type: 'text', text: '교토검색 본문', styles: {} }],
            children: [],
          },
        ],
      },
    })
  ).item;
  const response = await search('교토검색');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const found = await response.json();
  assert.deepEqual(new Set(found.items.map((item) => item.type)), new Set(['memo', 'page']));
  assert.equal(found.reset, false);
  assert.equal(found.reason, null);
  assert.equal((await (await search('100%')).json()).items[0].id, record.id);
  const file = (await (await search('탑승', 'file')).json()).items[0];
  assert.equal(file.href, '/captures/' + record.id);
  assert.equal((await fetch(base + file.href)).status, 200);
  const removed = await json('/api/captures/' + record.id + '/trash', 'POST', {
    operationId: randomUUID(),
    expectedVersion: record.version,
  });
  assert.equal((await (await search('탑승', 'file')).json()).items.length, 0);
  assert.equal((await (await search('교토검색', 'memo')).json()).items.length, 0);
  await json('/api/trash/' + removed.item.id + '/restore', 'POST', { operationId: randomUUID() });
  assert.equal((await (await search('탑승', 'file')).json()).items[0].id, record.files[0].id);
  for (let i = 0; i < 24; i++) await memo('목록검색 ' + i);
  const first = await (await search('목록검색', 'memo')).json();
  assert.equal(first.items.length, 20);
  assert.ok(first.nextCursor);
  const next = await (await search('목록검색', 'memo', first.nextCursor)).json();
  assert.equal(next.items.length, 4);
  assert.equal(new Set([...first.items, ...next.items].map((item) => item.id)).size, 24);
  await memo('목록검색 새로 저장');
  const reset = await (await search('목록검색', 'memo', first.nextCursor)).json();
  assert.equal(reset.reset, true);
  assert.equal(reset.items.length, 20);
  for (const invalid of [
    await search('x'.repeat(161)),
    await search('교토', 'bad'),
    await search('다른질의', 'memo', first.nextCursor),
    await search('교토', 'all', 'bad'),
  ]) {
    assert.equal(invalid.status, 400);
    assert.equal(typeof (await invalid.json()).error, 'string');
  }
  assert.equal((await (await search('여')).json()).reason, 'short_query');
});
