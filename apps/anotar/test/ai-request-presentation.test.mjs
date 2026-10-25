import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTemplates } from '../shared/prompts.ts';

test('template quick choices preserve edited labels and exclude archived or stale recent choices', async () => {
  const { quickRequestTemplates, templatePresentation } = await import('../src/prompts/requestPresentation.ts');
  const templates = defaultTemplates();
  templates[1].name = '내 자료 조사';
  templates[1].body = '# 원하는 결과\n{{content}}';
  const original = structuredClone(templates);
  const choices = quickRequestTemplates(templates, 'research-keyword', { free: 'travel-outline', research: 'missing' });
  assert.equal(choices.find(t => t.id === 'research-keyword').name, '내 자료 조사');
  assert.ok(!choices.some(t => t.id === 'research-brief'), 'URL 리서치 is merged into 리서치');
  assert.ok(choices.every(t => !t.archived));
  assert.deepEqual(templatePresentation(templates[1]).outline, ['원하는 결과']);
  assert.deepEqual(templates, original);
});

test('execution guidance blocks disabled, stale, unsupported or empty model without switching providers', async () => {
  const { describeExecution } = await import('../src/ai/executionPresentation.ts');
  const hive = { id: 'hive', label: 'Hive', model: 'chosen', enabled: true, status: 'configured', researchModes: ['url'] };
  const settings = { defaultProfile: 'hive', profiles: [hive] };
  const value = { profileId: 'hive', model: 'chosen' };
  assert.equal(describeExecution(settings, value, false, false).usable, true);
  assert.equal(describeExecution(settings, value, true, false).reason, 'unsupported');
  assert.equal(describeExecution(settings, { ...value, model: 'old' }, false, false).reason, 'stale');
  assert.equal(describeExecution({ ...settings, profiles: [{ ...hive, enabled: false, status: 'disabled' }] }, value, false, false).reason, 'disabled');
  assert.equal(describeExecution({ ...settings, profiles: [{ ...hive, model: '' }] }, { ...value, model: '' }, false, false).usable, false);
  assert.equal(describeExecution(settings, null, false, false).usable, false);
  assert.deepEqual(value, { profileId: 'hive', model: 'chosen' });
});

test('HTTP gateway runs without a model so its own default applies', async () => {
  const { describeExecution } = await import('../src/ai/executionPresentation.ts');
  const http = { id: 'http', label: 'HTTP', model: '', enabled: true, status: 'configured', researchModes: ['url', 'keyword'] };
  const settings = { defaultProfile: 'http', profiles: [http] };
  const result = describeExecution(settings, { profileId: 'http', model: '' }, false, false);
  assert.equal(result.reason, 'ready');
  assert.equal(result.usable, true);
});
