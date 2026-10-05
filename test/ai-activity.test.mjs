import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-ai-activity-'));
  const store = openStore(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return store;
}
const selection = { template: null, additional: 'PRIVATE-PROMPT' };
const note = (store, text = '여행 계획 정리') =>
  store.createCapture({ kind: 'note', text, aiRequest: selection });
function pageJob(store) {
  let page = store.createPage({ title: '여행 일정' });
  page = store.updatePage({
    ...page,
    expectedVersion: page.version,
    document: {
      schemaVersion: 1,
      blocks: [
        {
          id: randomUUID(),
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: '첫날은 여유롭게', styles: {} }],
          children: [],
        },
      ],
    },
  });
  return store.enqueuePageAiJob({
    pageId: page.id,
    requestId: randomUUID(),
    expectedVersion: page.version,
    aiRequest: selection,
  });
}

test('activity monitors memo and page jobs with bounded summaries and exact owner links', async (t) => {
  const store = await fixture(t);
  const capture = note(store, '읽어보기 '.repeat(1000));
  const page = pageJob(store);
  const running = store.claimAiJob({ label: '검증 실행기', mode: 'test' });
  assert.equal(running.captureId, capture.id);
  const activity = store.listAiActivity();
  assert.deepEqual(activity.counts, { queued: 1, running: 1, result_ready: 0, failed: 0 });
  assert.equal(activity.items.length, 2);
  const memo = activity.items.find((item) => item.id === running.id);
  assert.equal(memo.ownerKind, 'memo');
  assert.equal(memo.href, `/captures/${capture.id}?aiJob=${running.id}`);
  assert.ok(memo.preview.length <= 180);
  assert.ok(
    activity.items
      .find((item) => item.id === page.id)
      .href.includes(`/pages/${page.pageId}?aiJob=`),
  );
  for (const item of activity.items) {
    for (const key of ['request', 'result', 'sourceDocument', 'runToken', 'fingerprint'])
      assert.equal(key in item, false);
  }
  assert.equal(JSON.stringify(activity).includes('PRIVATE-PROMPT'), false);
});

test('activity prioritizes active work on home, filters states and keeps organized history visible', async (t) => {
  const store = await fixture(t);
  const capture = note(store);
  const run = store.claimAiJob();
  store.completeAiJob(run.id, run.runToken, {
    markdown: 'PRIVATE-RESULT',
    sources: [],
    usage: null,
  });
  const page = store.createPage({ title: '정리한 일정' });
  store.importCaptureIntoPage({
    pageId: page.id,
    captureId: capture.id,
    operationId: randomUUID(),
    disposition: 'organize',
    copyContent: true,
    assetIds: [],
  });
  const queued = pageJob(store);
  const failure = note(store, '실패 확인');
  const first = store.claimAiJob();
  assert.equal(first.id, queued.id);
  store.failAiJob(first.id, first.runToken, 'timeout');
  const next = store.claimAiJob();
  assert.equal(next.captureId, failure.id);
  const home = store.listAiActivity({ compact: true });
  assert.equal(home.items[0].id, next.id);
  assert.ok(home.items.find((item) => item.id === run.id).organized);
  assert.deepEqual(
    store.listAiActivity({ status: 'result_ready' }).items.map((item) => item.id),
    [run.id],
  );
  assert.equal(store.listAiActivity({ status: 'failed' }).items[0].errorCode, 'timeout');
  assert.equal(store.listAiActivity({ status: 'active' }).items[0].id, next.id);
  assert.equal(JSON.stringify(home).includes('PRIVATE-RESULT'), false);
  const before = store.getAiJob(run.id);
  store.listAiActivity();
  assert.deepEqual(store.getAiJob(run.id), before, 'monitoring is read-only');
});

test('activity excludes trash and validates filter and result bounds', async (t) => {
  const store = await fixture(t);
  const capture = note(store);
  const job = pageJob(store);
  const page = store.getPage(job.pageId);
  store.trashRecord({
    kind: 'capture',
    id: capture.id,
    expectedVersion: capture.version,
    operationId: randomUUID(),
  });
  store.trashRecord({
    kind: 'page',
    id: page.id,
    expectedVersion: page.version,
    operationId: randomUUID(),
  });
  assert.equal(store.listAiActivity().items.length, 0);
  assert.deepEqual(store.listAiActivity().counts, {
    queued: 0,
    running: 0,
    result_ready: 0,
    failed: 0,
  });
  assert.throws(() => store.listAiActivity({ status: 'bogus' }), /상태/);
  for (let i = 0; i < 55; i++) note(store, `독립 요청 ${i}`);
  assert.equal(store.listAiActivity().items.length, 50);
  assert.equal(store.listAiActivity().total, 55);
  assert.equal(store.listAiActivity({ compact: true }).items.length, 3);
});
