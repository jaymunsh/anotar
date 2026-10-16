import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function fixture(t, configured = true) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-ai-api-'));
  let calls = 0,
    seen = [];
  const gateway = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    seen.push(JSON.parse(Buffer.concat(chunks)));
    calls++;
    await delay(100);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ markdown: '# 결과\n\n글을 정리했어요.' }));
  });
  await new Promise((r) => gateway.listen(0, '127.0.0.1', r));
  const holder = createServer();
  await new Promise((r) => holder.listen(0, '127.0.0.1', r));
  const port = holder.address().port;
  await new Promise((r) => holder.close(r));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      AI_RUNNER_KIND: 'http',
      AI_RUNNER_URL: '',
      DATA_DIR: dir,
      PORT: String(port),
      HOST: '127.0.0.1',
      AI_RUNNER_URL: configured ? `http://127.0.0.1:${gateway.address().port}` : '',
      AI_RUNNER_LABEL: 'fixture',
      AI_RUNNER_MODE: 'test',
      AI_RUNNER_TOKEN: '',
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    await new Promise((r) => gateway.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await delay(25);
  }
  return { base, dir, calls: () => calls, seen };
}
const post = (base, path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
async function waitJob(base, id) {
  for (let i = 0; i < 100; i++) {
    const { item } = await (await fetch(base + '/api/ai-jobs/' + id)).json();
    if (['result_ready', 'failed'].includes(item?.status)) return item;
    await delay(10);
  }
  throw new Error('job did not settle');
}
function form(requestId, text = '계획 정리', file = false) {
  const body = new FormData();
  body.set('requestId', requestId);
  body.set('kind', file ? 'file' : 'note');
  body.set('text', text);
  body.set('url', '');
  body.set('aiRequest', JSON.stringify({ template: null, additional: '' }));
  if (file) {
    body.append('files', new Blob(['A']), 'first.txt');
    body.append('files', new Blob(['B'.repeat(10000)]), 'second.txt');
  }
  return body;
}

test('HTTP adapter advertises URL-only research and fails keyword requests without calling its summary endpoint', async (t) => {
  const { base, calls } = await fixture(t);
  const status = await (await fetch(base + '/api/ai/status')).json();
  assert.deepEqual(status.researchModes, ['url']);
  const library = await (await fetch(base + '/api/prompt-templates')).json();
  const template = library.items.find((item) => item.id === 'research-keyword');
  assert.ok(template);
  const body = form(randomUUID(), 'SQLite FTS5 주제 리서치');
  body.set('aiRequest', JSON.stringify({ template, additional: '' }));
  const saved = await (await fetch(base + '/api/captures', { method: 'POST', body })).json();
  const job = await waitJob(base, saved.aiJob.id);
  assert.equal(job.errorCode, 'research_search_unavailable');
  assert.equal(calls(), 0);
});

test('save returns queued work before remote completion, repeats do not duplicate files/jobs and results stay private', async (t) => {
  const { base, dir, calls, seen } = await fixture(t);
  const requestId = randomUUID();
  const response = await fetch(base + '/api/captures', {
    method: 'POST',
    body: form(requestId, '계획 정리', true),
  });
  assert.equal(response.status, 201);
  const { item, aiJob } = await response.json();
  assert.equal(aiJob.status, 'queued');
  assert.deepEqual(
    item.files.map((f) => f.name),
    ['first.txt', 'second.txt'],
  );
  const replay = await fetch(base + '/api/captures', {
    method: 'POST',
    body: form(requestId, '계획 정리', true),
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).item.id, item.id);
  assert.equal((await readdir(join(dir, 'blobs'))).length, 2);
  const result = await waitJob(base, aiJob.id);
  assert.equal(result.status, 'result_ready');
  assert.equal(result.runner.mode, 'test');
  assert.equal(calls(), 1);
  const batchResponse = await fetch(base + '/api/ai-jobs?ids=' + aiJob.id);
  assert.equal(batchResponse.status, 200);
  const batch = await batchResponse.json();
  assert.equal(batch.items[0].status, 'result_ready');
  assert.equal('request' in batch.items[0], false);
  assert.equal('result' in batch.items[0], false);
  assert.equal(
    (await fetch(base + '/api/ai-jobs?ids=' + Array(21).fill(aiJob.id).join(','))).status,
    400,
  );
  assert.equal(JSON.stringify(seen[0]).includes(item.files[0].key), false);
  assert.equal(
    (
      await fetch(base + '/api/captures', {
        method: 'POST',
        body: form(requestId, '다른 내용', true),
      })
    ).status,
    409,
  );
  assert.equal((await readdir(join(dir, 'blobs'))).length, 2);
  const retryId = randomUUID(),
    path = '/api/captures/' + item.id + '/ai-jobs';
  const next = await post(base, path, { requestId: retryId, expectedVersion: 1 });
  assert.equal(next.status, 201);
  const { item: nextJob } = await next.json();
  assert.equal(
    (await (await post(base, path, { requestId: retryId, expectedVersion: 1 })).json()).item.id,
    nextJob.id,
  );
  await waitJob(base, nextJob.id);
  assert.equal(calls(), 2);
  const oldReceipt = await (
    await fetch(base + '/api/captures', {
      method: 'POST',
      body: form(requestId, '계획 정리', true),
    })
  ).json();
  assert.equal(oldReceipt.aiJob.id, aiJob.id, 'capture replay returns the initially admitted job');
  const trashed = await (
    await post(base, '/api/captures/' + item.id + '/trash', {
      operationId: randomUUID(),
      expectedVersion: 1,
    })
  ).json();
  assert.ok(trashed.item);
  assert.equal((await fetch(base + '/api/ai-jobs/' + aiJob.id)).status, 404);
  assert.equal((await fetch(base + path)).status, 404);
});
test('disabled execution exposes nonsecret status and preserves successful save with actionable failure', async (t) => {
  const { base } = await fixture(t, false);
  const status = await (await fetch(base + '/api/ai/status')).json();
  assert.equal(status.enabled, false);
  assert.equal('token' in status, false);
  const response = await fetch(base + '/api/captures', {
    method: 'POST',
    body: form(randomUUID()),
  });
  assert.equal(response.status, 201);
  const { item, aiJob } = await response.json();
  const failed = await waitJob(base, aiJob.id);
  assert.equal(failed.errorCode, 'runner_unavailable');
  assert.equal(
    (await (await fetch(base + '/api/captures/' + item.id)).json()).item.text,
    '계획 정리',
  );
});
