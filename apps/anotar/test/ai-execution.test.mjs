import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { createAiExecutionService } from '../server/ai/execution.mjs';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-execution-'));
  const store = openStore(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const service = createAiExecutionService({
    store,
    env: {
      AI_RUNNER_KIND: 'hive',
      HIVE_API_KEY: 'secret-never-exposed',
      HIVE_MODEL: 'fixture/first',
      AI_DEVIN_BIN: '/not/installed',
    },
  });
  return { store, service };
}
test('settings persist, reject stale writes, and never expose keys/paths', async (t) => {
  const { store, service } = await fixture(t);
  const first = service.settings();
  assert.equal(first.defaultProfile, 'hive');
  assert.ok(!JSON.stringify(first).includes('secret-never-exposed'));
  assert.ok(!JSON.stringify(first).includes('/not/installed'));
  service.update({
    expectedVersion: first.version,
    defaultProfile: 'hive',
    models: { hive: 'fixture/second', devin: 'swe-2-high' },
  });
  assert.equal(service.settings().profiles[0].model, 'fixture/second');
  assert.throws(
    () =>
      service.update({
        expectedVersion: first.version,
        defaultProfile: 'devin',
        models: { hive: 'fixture/x', devin: 'swe-2-high' },
      }),
    /変更|변경|최신/,
  );
  const reopened = createAiExecutionService({ store, env: { HIVE_MODEL: 'new-env' } });
  assert.equal(reopened.settings().profiles[0].model, 'fixture/second');
});
test('new jobs pin execution at enqueue and same receipt/retry survives model change', async (t) => {
  const { store, service } = await fixture(t);
  const capture = store.createCapture({
    kind: 'note',
    text: '메모',
    sampleKey: 'prepared',
    aiRequest: { template: null, additional: '' },
  });
  const requestId = randomUUID();
  const old = store.enqueueAiJob({ captureId: capture.id, requestId, expectedVersion: 1 });
  assert.deepEqual(old.request.execution, { profileId: 'hive', model: 'fixture/first' });
  const settings = service.settings();
  service.update({
    expectedVersion: settings.version,
    defaultProfile: 'hive',
    models: { hive: 'fixture/second', devin: 'swe-2-high' },
  });
  assert.equal(
    store.enqueueAiJob({ captureId: capture.id, requestId, expectedVersion: 1 }).id,
    old.id,
  );
  const claim = store.claimAiJob(service.metadataFor);
  assert.equal(claim.runner.model, 'fixture/first');
  store.failAiJob(claim.id, claim.runToken, 'runner_failed');
  const retry = store.enqueueAiJob({
    captureId: capture.id,
    requestId: randomUUID(),
    expectedVersion: 1,
    retryOf: old.id,
  });
  assert.deepEqual(retry.request.execution, old.request.execution);
  assert.equal(service.forJob(retry).info.model, 'fixture/first');
});
test('client cannot inject executable/endpoint or stale model into jobs', async (t) => {
  const { store } = await fixture(t);
  const created = store.createPage({ title: '예시' });
  const page = store.updatePage({
    id: created.id,
    title: '예시',
    expectedVersion: 1,
    document: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'test-text',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: '본문', styles: {} }],
          children: [],
        },
      ],
    },
  });
  assert.throws(
    () =>
      store.enqueuePageAiJob({
        pageId: page.id,
        requestId: randomUUID(),
        expectedVersion: page.version,
        aiRequest: {
          template: null,
          additional: '',
          execution: { profileId: 'shell', model: 'rm' },
        },
      }),
    /실행/,
  );
  assert.throws(
    () =>
      store.enqueuePageAiJob({
        pageId: page.id,
        requestId: randomUUID(),
        expectedVersion: page.version,
        aiRequest: {
          template: null,
          additional: '',
          execution: { profileId: 'hive', model: 'old/model' },
        },
      }),
    /모델|설정/,
  );
});
test('legacy HTTP configuration without KIND stays selectable', async (t) => {
  const { store } = await fixture(t);
  const service = createAiExecutionService({
    store,
    env: {
      AI_RUNNER_URL: 'http://127.0.0.1:9999',
      AI_RUNNER_LABEL: 'Fixture gateway',
      AI_RUNNER_MODE: 'test',
    },
  });
  assert.equal(service.settings().defaultProfile, 'http');
  assert.equal(service.info.mode, 'test');
  assert.equal(service.info.label, 'Fixture gateway');
});

test('a saved blank Devin model never silently executes the fallback model', async (t) => {
  const { store } = await fixture(t);
  const service = createAiExecutionService({
    store,
    env: { AI_RUNNER_KIND: 'hive', AI_DEVIN_BIN: '/usr/bin/true', AI_DEVIN_MODEL: 'swe-2-high' },
  });
  service.update({ expectedVersion: 0, defaultProfile: 'devin', models: { hive: '', devin: '' } });
  assert.equal(service.settings().profiles.find((p) => p.id === 'devin').enabled, false);
  const pinned = service.resolveExecution({ profileId: 'devin', model: '' });
  assert.equal(service.forJob({ request: { execution: pinned } }).enabled, false);
  assert.equal(pinned.model, '');
});

test('OpenCode keyword capability follows the actual runner and respects global disable', async (t) => {
  const { store } = await fixture(t);
  const env = {
    AI_RUNNER_KIND: 'opencode',
    AI_OPENCODE_ENABLED: 'true',
    AI_OPENCODE_BIN: '/usr/bin/true',
    AI_OPENCODE_MODEL: 'opencode/big-pickle',
  };
  const service = createAiExecutionService({ store, env });
  assert.deepEqual(service.settings().profiles.find((p) => p.id === 'opencode').researchModes, [
    'url',
    'keyword',
  ]);
  assert.equal(service.discover, true);
  const disabled = createAiExecutionService({ store, env: { ...env, AI_RUNNER_KIND: 'disabled' } });
  assert.deepEqual(disabled.settings().profiles.find((p) => p.id === 'opencode').researchModes, []);
  assert.equal(disabled.discover, undefined);
});
