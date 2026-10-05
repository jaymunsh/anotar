import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('connection HTTP routes preserve byte assets, retry imports and child creation, and protect stale writes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-connection-api-'));
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      AI_RUNNER_KIND: 'disabled',
      AI_RUNNER_URL: '',
      DATA_DIR: dir,
      PORT: String(port),
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const post = (path, value) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  const data = new FormData();
  data.set('kind', 'file');
  data.set('text', '여행 준비');
  data.append('files', new Blob(['원본 파일 바이트'], { type: 'text/plain' }), '준비.txt');
  const { item: capture } = await (
    await fetch(base + '/api/captures', { method: 'POST', body: data })
  ).json();
  const { item: page } = await (await post('/api/pages', { title: '여행' })).json();
  assert.equal((await fetch(base + '/api/pages/search?q=여행')).status, 200);
  const payload = {
    operationId: randomUUID(),
    captureId: capture.id,
    copyContent: true,
    assetIds: [capture.files[0].id],
  };
  const response = await post(`/api/pages/${page.id}/capture-imports`, payload);
  assert.equal(response.status, 200);
  const imported = await response.json();
  assert.equal(imported.item.version, 2);
  assert.ok(imported.blockIds.length >= 3);
  assert.deepEqual(await (await post(`/api/pages/${page.id}/capture-imports`, payload)).json(), {
    ...imported,
    replayed: true,
  });
  assert.equal(
    (await post(`/api/pages/${page.id}/capture-imports`, { ...payload, copyContent: false }))
      .status,
    409,
  );
  assert.equal(
    (
      await post(`/api/pages/${randomUUID()}/capture-imports`, {
        ...payload,
        operationId: randomUUID(),
      })
    ).status,
    404,
  );
  assert.equal(
    (await post(`/api/pages/${page.id}/capture-imports`, { ...payload, operationId: 'bad' }))
      .status,
    400,
  );
  const stale = await fetch(base + '/api/pages/' + page.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...page, expectedVersion: 1 }),
  });
  assert.equal(stale.status, 409);
  assert.equal(
    (await fetch(base + `/api/assets/${capture.files[0].id}`)).headers.get('content-type'),
    'application/octet-stream',
  );
  assert.equal(
    await (await fetch(base + `/api/assets/${capture.files[0].id}`)).text(),
    '원본 파일 바이트',
  );
  const info = await (await fetch(base + `/api/assets/${capture.files[0].id}/info`)).json();
  assert.equal(info.item.name, '준비.txt');
  assert.equal(info.item.key, undefined);
  const children = {
    title: '첫날',
    parentId: page.id,
    captureImport: { ...payload, operationId: randomUUID() },
  };
  const created = await post('/api/pages', children);
  assert.equal(created.status, 201);
  const result = await created.json();
  assert.equal(result.item.parentId, page.id);
  assert.deepEqual(await (await post('/api/pages', children)).json(), {
    ...result,
    replayed: true,
  });
  const links = await (await fetch(base + `/api/captures/${capture.id}/pages`)).json();
  assert.equal(links.items.length, 2);
  assert.ok(links.items.every((item) => item.path.length > 0));
});
