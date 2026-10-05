import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

test('prompt API persists between clients and restart, validates requests and protects revisions', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-prompts-api-'));
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  let child;
  async function stop() {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  t.after(async () => {
    if (child?.exitCode === null) await stop();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  async function start() {
    child = spawn(process.execPath, ['server/index.mjs'], {
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
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(base + '/api/health')).ok) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('API did not start');
  }
  await start();
  const send = (path, method, body) =>
    fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const list = await fetch(base + '/api/prompt-templates');
  assert.equal(list.status, 200);
  const library = await list.json();
  assert.equal(library.items.length, 4);
  const input = {
    id: randomUUID(),
    name: '공유되는 요청',
    description: '',
    kind: 'free',
    body: '{{content}}를 정리해 주세요.',
    archived: false,
  };
  const made = await send('/api/prompt-templates', 'POST', input);
  assert.equal(made.status, 201);
  const { item } = await made.json();
  const update = {
    ...input,
    body: '최신 내용 {{content}}',
    expectedVersion: item.version,
    expectedRevisionId: item.revisionId,
  };
  const saved = await send(`/api/prompt-templates/${item.id}`, 'PUT', update);
  assert.equal(saved.status, 200);
  const latest = (await saved.json()).item;
  const stale = await send(`/api/prompt-templates/${item.id}`, 'PUT', {
    ...update,
    body: '늦은 수정',
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).current.body, latest.body);
  assert.equal(
    (
      await send(`/api/prompt-templates/${item.id}`, 'PUT', {
        ...update,
        expectedVersion: 2,
        expectedRevisionId: undefined,
      })
    ).status,
    400,
  );
  const archive = await send(`/api/prompt-templates/${item.id}`, 'PATCH', {
    archived: true,
    expectedVersion: latest.version,
    expectedRevisionId: latest.revisionId,
  });
  assert.equal(archive.status, 200);
  assert.equal((await archive.json()).item.archived, true);
  assert.equal(
    (
      await send('/api/prompt-templates', 'POST', {
        ...input,
        id: randomUUID(),
        body: '{{unknown}}',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await send('/api/prompt-templates', 'POST', {
        ...input,
        id: randomUUID(),
        body: '가'.repeat(30000),
      })
    ).status,
    400,
  );
  assert.equal((await fetch(base + '/api/prompt-templates/missing')).status, 404);
  const imported = await send('/api/prompt-templates/import', 'POST', {
    schemaVersion: 1,
    items: [{ ...input, id: randomUUID(), version: 5 }],
  });
  assert.equal(imported.status, 200);
  const importedId = (await imported.json()).mappings[0].targetId;
  await stop();
  await start();
  const again = await (await fetch(base + '/api/prompt-templates')).json();
  assert.equal(again.libraryId, library.libraryId);
  assert.equal(again.items.find((entry) => entry.id === item.id).body, latest.body);
  assert.equal(again.items.find((entry) => entry.id === item.id).archived, true);
  assert.equal(again.items.find((entry) => entry.id === importedId).body, input.body);
  // JSON escaping can make a valid library exceed 8MB without exceeding any template limit.
  const portable = Array.from({ length: 180 }, () => ({
    ...input,
    id: randomUUID(),
    version: 1,
    body: '\u0001'.repeat(10000),
  }));
  const portableImport = await send('/api/prompt-templates/import', 'POST', {
    schemaVersion: 1,
    items: portable,
  });
  assert.equal(
    portableImport.status,
    200,
    'valid maximum-length templates must remain portable as JSON',
  );
});
