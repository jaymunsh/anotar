import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

test('task API creates, edits, completes, paginates and protects newer versions', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-tasks-api-'));
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
      HOST: '127.0.0.1',
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const send = (path, method, body) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const requestId = randomUUID();
  const create = await send('/api/tasks', 'POST', { title: '할 일', requestId });
  assert.equal(create.status, 201);
  const { item } = await create.json();
  const repeat = await send('/api/tasks', 'POST', { title: '할 일', requestId });
  assert.equal((await repeat.json()).item.id, item.id);
  const saved = await send(`/api/tasks/${item.id}`, 'PATCH', {
    title: '기한도 확인',
    dueDate: '2026-09-30',
    expectedVersion: 1,
  });
  assert.equal(saved.status, 200);
  const { item: edited } = await saved.json();
  assert.equal(edited.version, 2);
  assert.equal(edited.createdAt, item.createdAt);
  const stale = await send(`/api/tasks/${item.id}`, 'PATCH', {
    status: 'done',
    expectedVersion: 1,
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).current.title, '기한도 확인');
  assert.equal(
    (await send(`/api/tasks/${item.id}`, 'PATCH', { dueDate: '2026-02-29', expectedVersion: 2 }))
      .status,
    400,
  );
  assert.equal(
    (await send(`/api/tasks/${randomUUID()}`, 'PATCH', { title: '없음', expectedVersion: 1 }))
      .status,
    404,
  );
  assert.equal((await send('/api/tasks', 'POST', { title: '' })).status, 400);
  assert.equal((await fetch(`${base}/api/tasks?status=bad`)).status, 400);
  assert.equal((await fetch(`${base}/api/tasks?limit=0`)).status, 400);
  const completed = await send(`/api/tasks/${item.id}`, 'PATCH', {
    status: 'done',
    expectedVersion: 2,
  });
  assert.equal((await completed.json()).item.status, 'done');
  const list = await (await fetch(`${base}/api/tasks?status=done&limit=1`)).json();
  assert.equal(list.items[0].id, item.id);
  assert.deepEqual(list.counts, { open: 0, done: 1 });
  const moved = await send(`/api/tasks/${item.id}`, 'PATCH', {
    stage: 'doing',
    expectedVersion: 3,
  });
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).item.stage, 'doing');
  const doing = await (await fetch(`${base}/api/tasks?stage=doing&limit=1`)).json();
  assert.equal(doing.items[0].id, item.id);
  assert.deepEqual(doing.counts, { open: 1, done: 0 });
  assert.deepEqual(doing.stageCounts, { todo: 0, doing: 1, done: 0 });
  assert.equal((await fetch(`${base}/api/tasks?stage=done`)).status, 200);
  assert.equal((await (await fetch(`${base}/api/tasks?stage=done`)).json()).items.length, 0);
  assert.equal((await fetch(`${base}/api/tasks?stage=invalid`)).status, 400);
  assert.equal(
    (await send(`/api/tasks/${item.id}`, 'PATCH', { stage: 'done', expectedVersion: 3 })).status,
    409,
  );
});
