import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
test('Page lifecycle HTTP contracts use saved documents, local worker, receipts and version conflicts', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-page-ai-api-'));
  let calls = 0;
  const gateway = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* drain local fixture input */
    }
    calls++;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ markdown: '# 결과\n\n정리했어요.' }));
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const holder = createServer();
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  const port = holder.address().port;
  await new Promise((resolve) => holder.close(resolve));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      PORT: String(port),
      HOST: '127.0.0.1',
      AI_RUNNER_KIND: 'http',
      AI_RUNNER_URL: `http://127.0.0.1:${gateway.address().port}`,
      AI_RUNNER_LABEL: 'local fixture',
      AI_RUNNER_MODE: 'test',
      AI_RUNNER_TOKEN: '',
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    await new Promise((resolve) => gateway.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await delay(25);
  }
  const send = (path, body, method = 'POST') =>
    fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const form = new FormData();
  form.set('kind', 'note');
  form.set('text', '원본 보존');
  const capture = (
    await (await fetch(base + '/api/captures', { method: 'POST', body: form })).json()
  ).item;
  const importBody = {
    title: '작업 페이지',
    captureImport: {
      operationId: randomUUID(),
      captureId: capture.id,
      copyContent: true,
      assetIds: [],
      disposition: 'organize',
    },
  };
  const imported = await (await send('/api/pages', importBody)).json();
  const inbox = await (await fetch(base + '/api/captures')).json();
  assert.equal(inbox.counts.memo, 0);
  const organized = await (await fetch(base + '/api/captures?organization=organized')).json();
  assert.equal(organized.counts.memo, 1);
  const page = imported.item,
    prefix = '/api/pages/' + page.id;
  assert.equal(
    (await (await fetch(base + prefix + '/origins')).json()).items[0].capture.id,
    capture.id,
  );
  const requestBody = {
    requestId: randomUUID(),
    expectedVersion: page.version,
    aiRequest: { template: null, additional: '' },
  };
  let job = (await (await send(prefix + '/ai-jobs', requestBody)).json()).item;
  for (let i = 0; i < 80; i++) {
    job = (await (await fetch(base + '/api/ai-jobs/' + job.id)).json()).item;
    if (job.status === 'result_ready') break;
    await delay(10);
  }
  assert.equal(job.status, 'result_ready');
  assert.equal(job.pageId, page.id);
  assert.equal(calls, 1);
  assert.equal((await (await send(prefix + '/ai-jobs', requestBody)).json()).item.id, job.id);
  assert.equal((await (await fetch(base + prefix + '/ai-jobs')).json()).items.length, 1);
  const document = {
    schemaVersion: 1,
    blocks: [
      {
        id: 'result',
        type: 'paragraph',
        props: {},
        content: [{ type: 'text', text: '제안 반영', styles: {} }],
        children: [],
      },
    ],
  };
  const applyBody = {
    operationId: randomUUID(),
    expectedVersion: page.version,
    jobId: job.id,
    mode: 'append',
    document,
  };
  const applied = await (await send(prefix + '/ai-applies', applyBody)).json();
  assert.equal(applied.replayed, false);
  assert.equal((await (await send(prefix + '/ai-applies', applyBody)).json()).replayed, true);
  assert.equal(
    (await send(prefix + '/ai-applies', { ...applyBody, operationId: randomUUID() })).status,
    409,
  );
  const undoBody = { operationId: randomUUID(), expectedVersion: applied.item.version };
  const undone = await (
    await send(prefix + '/ai-applies/' + applyBody.operationId + '/undo', undoBody)
  ).json();
  assert.deepEqual(undone.item.document, page.document);
  assert.equal(
    (await (await send(prefix + '/ai-applies/' + applyBody.operationId + '/undo', undoBody)).json())
      .replayed,
    true,
  );
  const restoreBody = {
    operationId: randomUUID(),
    expectedOrganizedOperationId: importBody.captureImport.operationId,
  };
  assert.equal(
    (await (await send('/api/captures/' + capture.id + '/unorganize', restoreBody)).json()).item
      .organizedAt,
    null,
  );
  assert.equal(
    (await (await send('/api/captures/' + capture.id + '/unorganize', restoreBody)).json())
      .replayed,
    true,
  );
});
