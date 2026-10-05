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

test('saved text and URL can be edited without changing creation time or accepting stale writes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-capture-edit-'));
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

  const note = new FormData();
  note.set('kind', 'note');
  note.set('text', '처음 메모');
  const createdResponse = await fetch(`${base}/api/captures`, { method: 'POST', body: note });
  assert.equal(createdResponse.status, 201);
  const { item: created } = await createdResponse.json();
  assert.equal(created.version, 1);
  assert.equal(created.updatedAt, created.createdAt);

  const patch = (id, body) =>
    fetch(`${base}/api/captures/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const savedResponse = await patch(created.id, {
    text: '고친 메모',
    expectedVersion: 1,
  });
  assert.equal(savedResponse.status, 200);
  const { item: saved } = await savedResponse.json();
  assert.equal(saved.text, '고친 메모');
  assert.equal(saved.version, 2);
  assert.equal(saved.createdAt, created.createdAt);
  assert.ok(Date.parse(saved.updatedAt) >= Date.parse(saved.createdAt));
  const { items: results } = await (await fetch(`${base}/api/captures?q=고친`)).json();
  assert.equal(results[0]?.id, created.id);
  assert.equal(results[0]?.version, 2);

  const staleResponse = await patch(created.id, { text: '늦은 메모', expectedVersion: 1 });
  assert.equal(staleResponse.status, 409);
  assert.equal((await staleResponse.json()).current.text, '고친 메모');
  assert.equal(
    (await (await fetch(`${base}/api/captures/${created.id}`)).json()).item.text,
    '고친 메모',
  );
  assert.equal((await patch(created.id, { text: '', expectedVersion: 2 })).status, 400);

  const link = new FormData();
  link.set('kind', 'link');
  link.set('url', 'https://example.com/old');
  link.set('text', '처음 설명');
  const { item: createdLink } = await (
    await fetch(`${base}/api/captures`, { method: 'POST', body: link })
  ).json();
  assert.equal(
    (
      await patch(createdLink.id, {
        text: '바뀐 설명',
        url: 'file:///private',
        expectedVersion: 1,
      })
    ).status,
    400,
  );
  const linkResponse = await patch(createdLink.id, {
    text: '바뀐 설명',
    url: 'https://example.org/new',
    expectedVersion: 1,
  });
  assert.equal(linkResponse.status, 200);
  assert.equal((await linkResponse.json()).item.url, 'https://example.org/new');
});
