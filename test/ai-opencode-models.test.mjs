import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { createAiExecutionService } from '../server/ai/execution.mjs';
const model = (id, enabled = true) => ({
  id,
  name: id,
  pricing: 'unknown',
  enabled,
  available: null,
});
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-models-'));
  const store = openStore(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    store,
    service: createAiExecutionService({
      store,
      env: {
        AI_RUNNER_KIND: 'hive',
        HIVE_MODEL: 'fixture/first',
        HIVE_API_KEY: 'secret',
        AI_OPENCODE_BIN: '/missing',
      },
    }),
  };
}
test('OpenCode catalog is seeded without overwriting existing Hive settings and can be edited/reopened', async (t) => {
  const { store, service } = await fixture(t);
  const initial = service.settings();
  const profile = initial.profiles.find((p) => p.id === 'opencode');
  assert.ok(profile);
  assert.equal(profile.catalog.length, 11);
  assert.ok(profile.catalog.every((entry) => entry.pricing === 'free'));
  assert.ok(profile.catalog.every((entry) => !entry.id.startsWith('opencode/jev-')));
  assert.equal(profile.enabled, false);
  service.update({
    expectedVersion: 0,
    defaultProfile: 'opencode',
    models: { hive: 'fixture/first', devin: 'swe-2-high', opencode: 'opencode/custom-free' },
    opencodeModels: [model('opencode/custom-free'), model('opencode/other', false)],
  });
  const next = createAiExecutionService({ store, env: { AI_RUNNER_KIND: 'hive' } }).settings();
  assert.equal(next.defaultProfile, 'opencode');
  assert.equal(next.profiles.find((p) => p.id === 'opencode').catalog.length, 2);
  assert.equal(next.profiles.find((p) => p.id === 'hive').model, 'fixture/first');
  assert.doesNotMatch(JSON.stringify(next), /secret|\/missing/);
});
test('only enabled declared models can be selected; saved historical jobs retain original model', async (t) => {
  const { service } = await fixture(t);
  service.update({
    expectedVersion: 0,
    defaultProfile: 'hive',
    models: { hive: 'fixture/first', devin: 'swe-2-high', opencode: 'opencode/one' },
    opencodeModels: [
      model('opencode/one'),
      model('opencode/two'),
      model('opencode/disabled', false),
    ],
  });
  assert.deepEqual(service.resolveExecution({ profileId: 'opencode', model: 'opencode/two' }), {
    profileId: 'opencode',
    model: 'opencode/two',
  });
  assert.throws(
    () => service.resolveExecution({ profileId: 'opencode', model: 'opencode/not-listed' }),
    /모델/,
  );
  assert.throws(
    () => service.resolveExecution({ profileId: 'opencode', model: 'opencode/disabled' }),
    /모델/,
  );
  service.update({
    expectedVersion: 1,
    defaultProfile: 'hive',
    models: { hive: 'fixture/first', devin: 'swe-2-high', opencode: 'opencode/two' },
    opencodeModels: [model('opencode/two')],
  });
  assert.equal(
    service.forJob({ request: { execution: { profileId: 'opencode', model: 'opencode/one' } } })
      .info.model,
    'opencode/one',
  );
});
test('invalid catalog, duplicate model IDs and missing defaults never partially save', async (t) => {
  const { service } = await fixture(t);
  for (const entries of [
    [model('opencode/x'), model('opencode/x')],
    [model('bad;command')],
    [{ ...model('opencode/x'), enabled: 'yes' }],
  ]) {
    assert.throws(() =>
      service.update({
        expectedVersion: 0,
        defaultProfile: 'opencode',
        models: { hive: 'fixture/first', devin: 'swe-2-high', opencode: 'opencode/x' },
        opencodeModels: entries,
      }),
    );
    assert.equal(service.settings().version, 0);
  }
  assert.throws(() =>
    service.update({
      expectedVersion: 0,
      defaultProfile: 'opencode',
      models: { hive: 'fixture/first', devin: 'swe-2-high', opencode: 'opencode/absent' },
      opencodeModels: [model('opencode/x')],
    }),
  );
});

test('refresh preview preserves manual edits/disabled choices, marks retired IDs, and adds new models disabled', async () => {
  const { mergeModelCatalog } = await import('../shared/aiModels.ts');
  const before = [
    { ...model('opencode/one'), name: '내 이름', pricing: 'paid' },
    model('opencode/gone', false),
    model('custom/private'),
  ];
  const remote = [
    { ...model('opencode/one'), name: 'remote', available: true },
    { ...model('opencode/new'), available: true },
  ];
  const result = mergeModelCatalog(before, remote);
  assert.equal(result.find((m) => m.id === 'opencode/one').name, '내 이름');
  assert.equal(result.find((m) => m.id === 'opencode/one').pricing, 'paid');
  assert.equal(result.find((m) => m.id === 'opencode/gone').enabled, false);
  assert.equal(result.find((m) => m.id === 'opencode/gone').available, false);
  assert.equal(result.find((m) => m.id === 'custom/private').available, null);
  assert.equal(result.find((m) => m.id === 'opencode/new').enabled, false);
});
test('official listing preview checks response size and format; never uses model text as code or custom endpoint', async () => {
  const { fetchOpenCodeModels } = await import('../server/ai/modelCatalog.mjs');
  const value = await fetchOpenCodeModels({
    fetchImpl: async (url) => {
      assert.equal(url, 'https://opencode.ai/zen/v1/models');
      return new Response(
        JSON.stringify({ data: [{ id: 'space-bunny-free' }, { id: 'new-unknown-free' }] }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    },
  });
  assert.equal(value.models[0].pricing, 'free');
  assert.equal(value.models.length, 1);
  assert.equal(value.models[0].enabled, false);
  assert.ok(value.models.every((entry) => entry.pricing === 'free'));
  for (const body of [{ data: [] }, { data: [{ id: 'x;$(evil)' }] }])
    await assert.rejects(
      fetchOpenCodeModels({
        fetchImpl: async () =>
          new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
      }),
    );
  await assert.rejects(
    fetchOpenCodeModels({
      fetchImpl: async () =>
        new Response('x'.repeat(513 * 1024), { headers: { 'Content-Type': 'application/json' } }),
    }),
  );
});
