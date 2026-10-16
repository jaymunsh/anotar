import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('trash HTTP contracts exclude inactive targets, preserve shared downloads, restore and reject stale writes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'leneu-trash-api-'));
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const server = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, AI_RUNNER_KIND: 'disabled', AI_RUNNER_URL: '', DATA_DIR: directory, PORT: String(port), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  t.after(async () => {
    server.kill();
    await once(server, 'exit');
    await rm(directory, { recursive: true, force: true });
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
  assert.equal((await fetch(base + '/api/trash')).status, 200);
  const form = new FormData();
  form.set('kind', 'file');
  form.set('text', '첨부 기록');
  form.append('files', new Blob(['보존할 바이트'], { type: 'text/plain' }), '기록.txt');
  const { item: memo } = await (
    await fetch(base + '/api/captures', { method: 'POST', body: form })
  ).json();
  const { item: page } = await (await post('/api/pages', { title: '연결 문서' })).json();
  const { item: child } = await (
    await post('/api/pages', { title: '하위 문서', parentId: page.id })
  ).json();
  const { item: imported } = await (
    await post(`/api/pages/${page.id}/capture-imports`, {
      operationId: randomUUID(),
      captureId: memo.id,
      copyContent: true,
      assetIds: [memo.files[0].id],
    })
  ).json();
  const deletion = { operationId: randomUUID(), expectedVersion: memo.version };
  const response = await post(`/api/captures/${memo.id}/trash`, deletion);
  assert.equal(response.status, 200);
  const deleted = await response.json();
  assert.deepEqual(await (await post(`/api/captures/${memo.id}/trash`, deletion)).json(), deleted);
  assert.equal((await fetch(base + '/api/captures/' + memo.id)).status, 404);
  assert.equal(
    (
      await post(`/api/pages/${page.id}/capture-imports`, {
        operationId: randomUUID(),
        captureId: memo.id,
        copyContent: false,
        assetIds: [],
      })
    ).status,
    404,
  );
  assert.equal(
    await (await fetch(base + '/api/assets/' + memo.files[0].id)).text(),
    '보존할 바이트',
  );
  const pageDeleted = await post(`/api/pages/${page.id}/trash`, {
    operationId: randomUUID(),
    expectedVersion: imported.version,
  });
  assert.equal(pageDeleted.status, 200);
  const pageBatch = await pageDeleted.json();
  assert.equal(pageBatch.item.count, 2);
  assert.equal((await fetch(base + '/api/pages/' + child.id)).status, 404);
  assert.equal((await fetch(base + '/api/assets/' + memo.files[0].id)).status, 404);
  assert.equal((await fetch(base + '/api/assets/' + memo.files[0].id + '/info')).status, 404);
  assert.equal((await (await fetch(base + '/api/pages/search?q=하위')).json()).items.length, 0);
  assert.deepEqual((await (await fetch(base + '/api/trash?type=page')).json()).counts, {
    all: 2,
    capture: 1,
    page: 1,
  });
  assert.equal(
    (await post(`/api/trash/${pageBatch.item.id}/restore`, { operationId: randomUUID() })).status,
    200,
  );
  assert.equal((await fetch(base + '/api/assets/' + memo.files[0].id)).status, 200);
  assert.equal(
    (await post(`/api/trash/${deleted.item.id}/restore`, { operationId: randomUUID() })).status,
    200,
  );
  const restored = (await (await fetch(base + '/api/captures/' + memo.id)).json()).item;
  assert.equal(restored.createdAt, memo.createdAt);
  assert.equal(restored.updatedAt, memo.updatedAt);
  const stale = await fetch(base + '/api/captures/' + memo.id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: memo.version, text: '늦은 저장' }),
  });
  assert.equal(stale.status, 409);
  assert.equal(
    (
      await post(`/api/captures/${memo.id}/trash`, {
        operationId: 'bad',
        expectedVersion: restored.version,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(`/api/captures/${memo.id}/trash`, {
        operationId: randomUUID(),
        expectedVersion: memo.version,
      })
    ).status,
    409,
  );
  assert.equal(
    (await post(`/api/trash/${randomUUID()}/restore`, { operationId: randomUUID() })).status,
    404,
  );
  assert.equal((await fetch(base + '/api/trash?type=bad')).status, 400);
  assert.equal((await fetch(base + '/api/trash?cursor=bad')).status, 400);
});
