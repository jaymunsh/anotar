import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('page API creates, saves, reloads, and rejects stale writes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-page-api-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, AI_RUNNER_KIND: 'disabled', AI_RUNNER_URL: '', DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  t.after(async () => {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const createdResponse = await fetch(`${base}/api/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '여행 계획' }),
  });
  assert.equal(createdResponse.status, 201);
  const { item: created } = await createdResponse.json();
  assert.equal(created.version, 1);
  const document = {
    schemaVersion: 1,
    blocks: [
      {
        id: 'diagram-one',
        type: 'diagram',
        props: {},
        content: [{ type: 'text', text: 'graph TD\nA-->B', styles: {} }],
        children: [],
      },
    ],
  };
  const savedResponse = await fetch(`${base}/api/pages/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '교토 여행', document, expectedVersion: 1 }),
  });
  assert.equal(savedResponse.status, 200);
  assert.equal((await savedResponse.json()).item.version, 2);
  const readResponse = await fetch(`${base}/api/pages/${created.id}`);
  assert.deepEqual((await readResponse.json()).item.document, document);
  const staleResponse = await fetch(`${base}/api/pages/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '늦은 저장', document, expectedVersion: 1 }),
  });
  assert.equal(staleResponse.status, 409);
  const listResponse = await fetch(`${base}/api/pages`);
  assert.equal((await listResponse.json()).items[0].title, '교토 여행');
});
