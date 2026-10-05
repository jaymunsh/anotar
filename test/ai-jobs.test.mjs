import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';

const selection = { template: null, additional: '간결하게 정리해 주세요' };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-ai-jobs-'));
  const store = openStore(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, store };
}
const note = (store, extra = {}) =>
  store.createCapture({ kind: 'note', text: '교토 여행 계획', aiRequest: selection, ...extra });

test('AI capture and immutable queued snapshot persist atomically; ordinary and sample captures do not execute', async (t) => {
  const { store, dir } = await fixture(t);
  const ordinary = store.createCapture({ kind: 'note', text: '일반 메모' });
  const sample = note(store, { sampleKey: 'old.prepared' });
  const item = note(store);
  assert.equal(ordinary.latestAiJob, null);
  assert.equal(sample.latestAiJob, null);
  assert.equal(item.latestAiJob.status, 'queued');
  const [job] = store.listAiJobs(item.id);
  assert.equal(job.sourceVersion, 1);
  assert.equal(job.request.prompt, item.aiRequest.prompt);
  assert.equal(job.result, null);
  const second = openStore(dir);
  t.after(() => second.close());
  assert.equal(second.listAiJobs(item.id)[0].id, job.id);
  assert.equal(second.listAiJobs(sample.id).length, 0);
  assert.equal(second.getAiJob(job.id).status, 'queued');
});

test('capture receipts replay the same UUID despite new blob keys; content/order/digest conflicts reject', async (t) => {
  const { store } = await fixture(t);
  const requestId = randomUUID();
  const file = {
    key: 'first-blob',
    name: '안내.txt',
    mime: 'text/plain',
    size: 3,
    sha256: 'a'.repeat(64),
  };
  const args = { kind: 'file', text: '읽어보기', files: [file], aiRequest: selection, requestId };
  const first = store.saveCapture(args);
  const replay = store.saveCapture({ ...args, files: [{ ...file, key: 'retry-blob' }] });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.item.id, first.item.id);
  assert.equal(replay.item.files[0].key, 'first-blob');
  assert.equal(store.listAiJobs(first.item.id).length, 1);
  for (const changed of [
    { text: '다른 글' },
    { files: [{ ...file, sha256: 'b'.repeat(64) }] },
    { aiRequest: { ...selection, additional: '다른 요청' } },
  ])
    assert.throws(() => store.saveCapture({ ...args, ...changed }), /다른|일치/);
  assert.equal(store.listCaptures().length, 1);
  assert.throws(() => store.saveCapture({ ...args, requestId: 'invalid' }), /식별/);
  assert.throws(
    () =>
      store.saveCapture({
        ...args,
        requestId: randomUUID(),
        files: [{ ...file, sha256: undefined }],
      }),
    /파일/,
  );
});

test('job insertion failure rolls back capture, files and receipt together', async (t) => {
  const { dir, store } = await fixture(t);
  const external = new DatabaseSync(join(dir, 'storage.sqlite'));
  external.exec(
    "CREATE TRIGGER reject_ai_job BEFORE INSERT ON ai_jobs BEGIN SELECT RAISE(ABORT, 'test rollback'); END",
  );
  external.close();
  assert.throws(
    () =>
      note(store, {
        requestId: randomUUID(),
        files: [{ key: 'x', name: 'x', mime: 'text/plain', size: 1, sha256: 'a'.repeat(64) }],
      }),
    /test rollback/,
  );
  assert.equal(store.listCaptures().length, 0);
});

test('claim token is exclusive and late completion cannot overwrite a terminal result', async (t) => {
  const { store } = await fixture(t);
  const item = note(store);
  const run = store.claimAiJob({ label: 'fixture', mode: 'test' });
  assert.equal(run.captureId, item.id);
  assert.equal(run.status, 'running');
  assert.equal(store.claimAiJob(), null);
  assert.equal(
    store.completeAiJob(run.id, 'wrong-token', { markdown: '늦음', sources: [], usage: null }),
    false,
  );
  assert.equal(
    store.completeAiJob(run.id, run.runToken, { markdown: '정리 결과', sources: [], usage: null }),
    true,
  );
  assert.equal(store.failAiJob(run.id, run.runToken, 'timeout'), false);
  assert.equal(store.getAiJob(run.id).result.markdown, '정리 결과');
  assert.equal(store.getCapture(item.id).text, item.text);
});

test('retry snapshots preserve history; current-content requests use latest version, replay before stale validation', async (t) => {
  const { store } = await fixture(t);
  const item = note(store);
  const run = store.claimAiJob();
  store.failAiJob(run.id, run.runToken, 'runner_unavailable');
  const edited = store.updateCapture({ id: item.id, text: '수정한 계획', expectedVersion: 1 });
  assert.equal(store.getAiJob(run.id).stale, true);
  const requestId = randomUUID();
  const next = store.enqueueAiJob({
    captureId: item.id,
    requestId,
    expectedVersion: edited.version,
  });
  assert.equal(next.request.input.content, '수정한 계획');
  assert.equal(next.sourceVersion, 2);
  store.updateCapture({ id: item.id, text: '또 수정', expectedVersion: 2 });
  assert.equal(
    store.enqueueAiJob({ captureId: item.id, requestId, expectedVersion: 2 }).id,
    next.id,
  );
  assert.throws(
    () => store.enqueueAiJob({ captureId: item.id, requestId, expectedVersion: 3 }),
    /다른|일치/,
  );
  const nextRun = store.claimAiJob();
  store.failAiJob(nextRun.id, nextRun.runToken, 'timeout');
  const retry = store.enqueueAiJob({
    captureId: item.id,
    requestId: randomUUID(),
    expectedVersion: 3,
    retryOf: run.id,
  });
  assert.equal(retry.sourceVersion, 1);
  assert.equal(retry.request.input.content, '교토 여행 계획');
  assert.equal(retry.retryOf, run.id);
  assert.equal(store.listAiJobs(item.id).length, 3);
});

test('restart interrupts only running work, queued stays, old tokens fail and samples remain prepared', async (t) => {
  const { store } = await fixture(t);
  const first = note(store);
  const second = note(store, { text: '대기 작업' });
  const run = store.claimAiJob();
  assert.equal(store.interruptAiJobs(), 1);
  assert.equal(store.getAiJob(run.id).errorCode, 'interrupted');
  assert.equal(store.getCapture(second.id).latestAiJob.status, 'queued');
  assert.equal(
    store.completeAiJob(run.id, run.runToken, { markdown: '늦은 답', sources: [], usage: null }),
    false,
  );
  assert.equal(store.getCapture(first.id).text, '교토 여행 계획');
});

test('trashed owner hides jobs, queued work is cancelled before claim, restoring retains history', async (t) => {
  const { store } = await fixture(t);
  const item = note(store);
  const jobId = item.latestAiJob.id;
  const trashed = store.trashRecord({
    kind: 'capture',
    id: item.id,
    operationId: randomUUID(),
    expectedVersion: 1,
  });
  assert.equal(store.getAiJob(jobId), null);
  assert.equal(store.listAiJobs(item.id), null);
  assert.equal(store.claimAiJob(), null);
  store.restoreTrash({ id: trashed.item.id, operationId: randomUUID() });
  assert.equal(store.getAiJob(jobId).errorCode, 'source_deleted');
});

test('active job blocks accidental second admission and retry cannot target another capture', async (t) => {
  const { store } = await fixture(t);
  const a = note(store);
  const b = note(store);
  assert.throws(
    () => store.enqueueAiJob({ captureId: a.id, requestId: randomUUID(), expectedVersion: 1 }),
    /진행/,
  );
  const run = store.claimAiJob();
  store.failAiJob(run.id, run.runToken, 'timeout');
  assert.throws(
    () =>
      store.enqueueAiJob({
        captureId: a.id,
        requestId: randomUUID(),
        expectedVersion: 1,
        retryOf: b.latestAiJob.id,
      }),
    /이전/,
  );
  assert.throws(
    () => store.enqueueAiJob({ captureId: a.id, requestId: randomUUID(), expectedVersion: 9 }),
    /수정/,
  );
});
