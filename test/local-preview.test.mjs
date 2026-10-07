import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { openStore } from '../server/store.mjs';

test('local preview preserves queued and running AI jobs instead of consuming the copied queue', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'anotar-preview-'));
  const store = openStore(dir);
  const queued = store.createCapture({ kind: 'note', text: 'queued fixture', aiRequest: { template: null, additional: '' } });
  store.claimAiJob({ label: 'fixture' });
  const second = store.createCapture({ kind: 'note', text: 'second fixture', aiRequest: { template: null, additional: '' } });
  const holder = createServer();
  await new Promise(r => holder.listen(0, '127.0.0.1', r));
  const port = holder.address().port;
  await new Promise(r => holder.close(r));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: { PATH: process.env.PATH, DATA_DIR: dir, HOST: '127.0.0.1', PORT: String(port), AUTH_MODE: 'disabled', AI_RUNNER_KIND: 'disabled', BACKGROUND_WORKERS_ENABLED: 'false' },
    stdio: 'ignore',
  });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    store.close(); await rm(dir, { recursive: true, force: true });
  });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch {}
    if (ready) break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.ok(ready, 'preview server starts');
  await new Promise(r => setTimeout(r, 150));
  assert.equal(store.getAiJob(queued.latestAiJob.id).status, 'running');
  assert.equal(store.getAiJob(second.latestAiJob.id).status, 'queued');
});

test('local preview can explicitly run AI while other background workers remain disabled', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'anotar-preview-ai-'));
  const store = openStore(dir);
  const item = store.createCapture({ kind: 'note', text: 'local AI fixture', aiRequest: { template: null, additional: '' } });
  let calls = 0;
  const runner = createHttpServer(async (request, response) => {
    for await (const _chunk of request) {}
    calls++;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ markdown: 'Local fixture result', sources: [] }));
  });
  await new Promise(r => runner.listen(0, '127.0.0.1', r));
  const holder = createServer();
  await new Promise(r => holder.listen(0, '127.0.0.1', r));
  const port = holder.address().port;
  await new Promise(r => holder.close(r));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: { PATH: process.env.PATH, DATA_DIR: dir, HOST: '127.0.0.1', PORT: String(port), AUTH_MODE: 'disabled', AI_RUNNER_KIND: 'http', AI_RUNNER_URL: `http://127.0.0.1:${runner.address().port}`, BACKGROUND_WORKERS_ENABLED: 'false', AI_WORKER_ENABLED: 'true' },
    stdio: 'ignore',
  });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    await new Promise(r => runner.close(r));
    store.close(); await rm(dir, { recursive: true, force: true });
  });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch {}
    if (ready) break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.ok(ready, 'preview server starts');
  for (let i = 0; i < 40 && ['queued', 'running'].includes(store.getAiJob(item.latestAiJob.id).status); i++)
    await new Promise(r => setTimeout(r, 50));
  assert.equal(store.getAiJob(item.latestAiJob.id).status, 'result_ready');
  assert.equal(calls, 1);
  assert.equal(store.getCapture(item.id).text, 'local AI fixture');
});
