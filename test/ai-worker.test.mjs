import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { createAiWorker } from '../server/ai/worker.mjs';
import { validateAiResult } from '../server/ai/contracts.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(read, predicate) {
  for (let i = 0; i < 100; i++) {
    const value = read();
    if (predicate(value)) return value;
    await delay(5);
  }
  throw new Error('state did not settle');
}
async function fixture(t, runner, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-ai-worker-'));
  const store = openStore(dir);
  const worker = createAiWorker({ store, runner, ...extra });
  t.after(async () => {
    await worker.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { store, worker };
}
const save = (store, text = '계획 정리') =>
  store.createCapture({ kind: 'note', text, aiRequest: { template: null, additional: '' } });

test('worker emits start and fenced failure events without waiting for notification delivery', async (t) => {
  const events = [];
  const { store, worker } = await fixture(t, {
    enabled: true, info: { label: 'fixture', mode: 'test' },
    async run() { throw Object.assign(new Error('private detail'), { code: 'timeout' }); },
  }, { notifier: { notify(event, job, code) { events.push([event, job.id, code]); return new Promise(() => {}); } } });
  const item = save(store);
  worker.start();
  const failed = await until(() => store.getAiJob(item.latestAiJob.id), value => value.status === 'failed');
  assert.equal(failed.errorCode, 'timeout');
  assert.deepEqual(events, [['started', failed.id, undefined], ['failed', failed.id, 'timeout']]);
  worker.wake();
  await delay(10);
  assert.equal(events.length, 2);
});
const researchTemplate = {
  id: 'research-test',
  name: '리서치',
  description: '',
  kind: 'research',
  body: '{{content}}',
  archived: false,
  version: 1,
};
const saveResearch = (store, text) =>
  store.createCapture({
    kind: 'note',
    text,
    aiRequest: { template: researchTemplate, additional: '' },
  });

test('keyword research finds sources before summarizing actual bodies and leaves the raw memo untouched', async (t) => {
  const events = [];
  const { store, worker } = await fixture(
    t,
    {
      enabled: true,
      info: { label: 'fixture', mode: 'test' },
      async discover({ job }) {
        events.push(job.request.input.content);
        return [{ url: 'https://example.com/blocked' }, { url: 'https://example.com/read' }];
      },
      async run({ materials, research }) {
        assert.equal(materials.length, 1);
        assert.equal(materials[0].text, '실제로 가져온 본문');
        assert.deepEqual(research, { mode: 'keyword', candidateCount: 2, collectedCount: 1 });
        events.push('summarize');
        return { markdown: '## 핵심 요약\n\n- 본문 요약', sources: [{ url: materials[0].url }] };
      },
    },
    {
      collect: async (url) => {
        events.push(url);
        if (url.endsWith('/blocked')) {
          const error = new Error();
          error.code = 'research_blocked';
          throw error;
        }
        return {
          url,
          title: '원문',
          text: '실제로 가져온 본문',
          fetchedAt: '2026-09-29T00:00:00Z',
        };
      },
    },
  );
  const item = saveResearch(store, 'N100 SQLite FTS5 장단점');
  worker.start();
  const result = await until(
    () => store.getAiJob(item.latestAiJob.id),
    (value) => ['result_ready', 'failed'].includes(value.status),
  );
  assert.equal(result.status, 'result_ready');
  assert.deepEqual(events, [
    'N100 SQLite FTS5 장단점',
    'https://example.com/blocked',
    'https://example.com/read',
    'summarize',
  ]);
  assert.match(result.result.markdown, /검색 후보 2개 중 본문을 확인한 1개/);
  assert.deepEqual(
    result.result.sources.map((source) => [source.url, source.verified]),
    [['https://example.com/read', true]],
  );
  assert.equal(store.getCapture(item.id).text, 'N100 SQLite FTS5 장단점');
  assert.equal(store.getCapture(item.id).updatedAt, item.updatedAt);
});

test('research with a URL bypasses keyword discovery, and direct free requests never search', async (t) => {
  const { store, worker } = await fixture(
    t,
    {
      enabled: true,
      info: null,
      discover() {
        throw new Error('unexpected keyword search');
      },
      async run({ job, materials }) {
        if (job.request.kind === 'research')
          assert.equal(materials[0].url, 'https://example.com/article');
        else assert.deepEqual(materials, []);
        return { markdown: '정리' };
      },
    },
    { collect: async (url) => ({ url, title: '글', text: '본문', fetchedAt: 'now' }) },
  );
  const url = saveResearch(store, '이 URL이 우선: https://example.com/article');
  const free = save(store, 'SQLite 장단점');
  worker.start();
  await until(
    () => store.getAiJob(free.latestAiJob.id),
    (value) => value.status === 'result_ready',
  );
  assert.equal(store.getAiJob(url.latestAiJob.id).status, 'result_ready');
});

test('keyword research without search capability or any accessible body fails without a fabricated summary', async (t) => {
  for (const available of [false, true]) {
    const { store, worker } = await fixture(
      t,
      {
        enabled: true,
        info: null,
        ...(available ? { discover: async () => [{ url: 'https://example.com/' }] } : {}),
        run() {
          throw new Error('must not summarize unverified data');
        },
      },
      {
        collect: async () => {
          const error = new Error();
          error.code = 'research_failed';
          throw error;
        },
      },
    );
    const item = saveResearch(store, 'SQLite 주제');
    worker.start();
    const result = await until(
      () => store.getAiJob(item.latestAiJob.id),
      (value) => value.status === 'failed',
    );
    assert.equal(
      result.errorCode,
      available ? 'research_no_sources' : 'research_search_unavailable',
    );
    assert.equal(result.result, null);
    assert.equal(store.getCapture(item.id).text, 'SQLite 주제');
  }
});

test('keyword discovery shares the job deadline and cannot complete late or start a summary', async (t) => {
  let finish;
  const { store, worker } = await fixture(
    t,
    {
      enabled: true,
      info: null,
      discover: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      run() {
        throw new Error('must not summarize after timeout');
      },
    },
    { timeoutMs: 20 },
  );
  const item = saveResearch(store, 'SQLite 주제');
  worker.start();
  const result = await until(
    () => store.getAiJob(item.latestAiJob.id),
    (value) => value.status === 'failed',
  );
  assert.equal(result.errorCode, 'timeout');
  finish([{ url: 'https://example.com/' }]);
  await delay(10);
  assert.equal(store.getAiJob(result.id).result, null);
});

test('worker is sequential and validates results without rewriting source or timestamps', async (t) => {
  let active = 0,
    max = 0,
    calls = [];
  const runner = {
    enabled: true,
    info: { label: 'fixture', mode: 'test' },
    async run({ job }) {
      active++;
      max = Math.max(max, active);
      calls.push(job.captureId);
      await delay(10);
      active--;
      return { markdown: '# 정리\n\n' + job.request.input.content };
    },
  };
  const { store, worker } = await fixture(t, runner);
  const a = save(store),
    b = save(store, '두 번째');
  worker.start();
  await until(
    () => store.getAiJob(b.latestAiJob.id),
    (v) => v.status === 'result_ready',
  );
  assert.equal(max, 1);
  assert.deepEqual(calls, [a.id, b.id]);
  assert.equal(store.getCapture(a.id).updatedAt, a.updatedAt);
  assert.equal(store.getAiJob(a.latestAiJob.id).runner.mode, 'test');
  assert.equal(store.getAiJob(a.latestAiJob.id).result.usage, null);
});

test('missing executor and file-only input fail honestly while preserving saved memo', async (t) => {
  const { store, worker } = await fixture(t, { enabled: false, info: null });
  const item = save(store);
  worker.start();
  const job = await until(
    () => store.getAiJob(item.latestAiJob.id),
    (v) => v.status === 'failed',
  );
  assert.equal(job.errorCode, 'runner_unavailable');
  assert.equal(store.getCapture(item.id).text, item.text);
});

test('timeout and shutdown settle promptly even with an executor ignoring abort; late replies are ignored', async (t) => {
  let finish;
  const runner = {
    enabled: true,
    info: { label: 'fixture', mode: 'test' },
    run: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  };
  const { store, worker } = await fixture(t, runner, { timeoutMs: 20 });
  const item = save(store);
  worker.start();
  const job = await until(
    () => store.getAiJob(item.latestAiJob.id),
    (v) => v.status === 'failed',
  );
  assert.equal(job.errorCode, 'timeout');
  finish({ markdown: '늦은 결과' });
  await delay(10);
  assert.equal(store.getAiJob(job.id).result, null);
  const next = save(store, '종료 중');
  worker.wake();
  await until(
    () => store.getAiJob(next.latestAiJob.id),
    (v) => v.status === 'running',
  );
  await worker.stop();
  assert.equal(store.getAiJob(next.latestAiJob.id).errorCode, 'interrupted');
  finish({ markdown: '종료 뒤 응답' });
  await delay(10);
  assert.equal(store.getAiJob(next.latestAiJob.id).result, null);
});

test('bad envelopes/unsafe sources are rejected, researched sources are server-grounded, usage remains optional', () => {
  for (const value of [
    null,
    { markdown: '' },
    { markdown: 'x'.repeat(256 * 1024) },
    { markdown: 'ok', sources: [{ url: 'javascript:alert(1)' }] },
    { markdown: 'ok', usage: { inputTokens: -1 } },
  ])
    assert.throws(
      () => validateAiResult(value),
      (e) => e.code === 'invalid_result',
    );
  const materials = [
    { url: 'https://example.com/', title: '실제 본문', fetchedAt: '2026-09-29T00:00:00.000Z' },
  ];
  assert.throws(
    () =>
      validateAiResult(
        { markdown: 'ok', sources: [{ url: 'https://invented.example/' }] },
        { kind: 'research', materials },
      ),
    (e) => e.code === 'invalid_result',
  );
  assert.equal(
    validateAiResult({ markdown: 'ok' }, { kind: 'research', materials }).sources[0].verified,
    true,
  );
  assert.equal(
    validateAiResult({ markdown: 'ok', sources: [{ url: 'https://example.com/' }] }).sources[0]
      .verified,
    false,
  );
});

test('research collection failure is distinct and never asks executor to invent contents', async (t) => {
  let calls = 0;
  const { store, worker } = await fixture(
    t,
    {
      enabled: true,
      info: null,
      run: async () => {
        calls++;
        return { markdown: 'invented' };
      },
    },
    {
      collect: async () => {
        const error = new Error();
        error.code = 'research_blocked';
        throw error;
      },
    },
  );
  const item = save(store, 'https://127.0.0.1/private');
  worker.start();
  const job = await until(
    () => store.getAiJob(item.latestAiJob.id),
    (v) => v.status === 'failed',
  );
  assert.equal(job.errorCode, 'research_blocked');
  assert.equal(calls, 0);
});

test('file bytes are never forwarded and unsupported file-only requests fail before executor', async (t) => {
  let received;
  const { store, worker } = await fixture(t, {
    enabled: true,
    info: null,
    run: async (args) => {
      received = args;
      return { markdown: '글만 처리' };
    },
  });
  const files = [{ key: 'private-storage', name: 'secret.txt', mime: 'text/plain', size: 99 }];
  const a = store.createCapture({
    kind: 'file',
    files,
    aiRequest: { template: null, additional: '' },
  });
  const b = store.createCapture({
    kind: 'file',
    files,
    text: '이 글만 정리',
    aiRequest: { template: null, additional: '' },
  });
  worker.start();
  await until(
    () => store.getAiJob(b.latestAiJob.id),
    (v) => v.status === 'result_ready',
  );
  assert.equal(store.getAiJob(a.latestAiJob.id).errorCode, 'unsupported_input');
  assert.equal(JSON.stringify(received).includes('private-storage'), false);
});

test('a failed per-job adapter selection settles the job and releases queue capacity', async t => {
  const {store,worker}=await fixture(t,{enabled:true,info:{label:'Fixture',mode:'test'},forJob(){throw Error('adapter unavailable');}});
  const capture=save(store);worker.start();
  const job=await until(()=>store.getAiJob(capture.latestAiJob.id),v=>v.status==='failed');
  assert.equal(job.errorCode,'runner_failed');
  const next=save(store,'다음 요청');worker.wake();
  await until(()=>store.getAiJob(next.latestAiJob.id),v=>v.status==='failed');
});
