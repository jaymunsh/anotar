import test from 'node:test';
import assert from 'node:assert/strict';

const flow = await import('../src/ai/followup.ts').catch(() => ({}));
const job = {
  id: '11111111-1111-4111-8111-111111111111',
  request: {
    input: { content: 'Original memo', url: 'https://example.com/source' },
    additional: 'Prior instruction',
    execution: { profileId: 'hive', model: 'model-a', options: {} },
  },
  result: { markdown: '# Result\n\nGenerated answer' },
};

test('followup result source keeps generated text separate from editable instruction and excludes original URL', () => {
  assert.equal(typeof flow.createAiFollowup, 'function');
  const source = flow.createAiFollowup(job, 'result');
  assert.equal(source.content, '# Result\n\nGenerated answer');
  assert.equal(source.url, '');
  assert.equal(source.additional, '');
  assert.equal(source.jobId, job.id);
  job.result.markdown = 'later change';
  assert.equal(source.content, '# Result\n\nGenerated answer');
});

test('request edit preserves the exact original snapshot, instruction and chosen execution', () => {
  assert.equal(typeof flow.createAiFollowup, 'function');
  const source = flow.createAiFollowup(job, 'original', true);
  assert.equal(source.content, 'Original memo');
  assert.equal(source.url, 'https://example.com/source');
  assert.equal(source.additional, 'Prior instruction');
  assert.deepEqual(source.execution, { profileId: 'hive', model: 'model-a', options: {} });
  job.request.input.content = 'changed memo';
  job.request.execution.model = 'changed model';
  assert.equal(source.content, 'Original memo');
  assert.equal(source.execution.model, 'model-a');
});

test('followup submission replays its UUID for an ambiguous response and allocates a new one when instruction changes', async () => {
  assert.equal(typeof flow.prepareAiFollowup, 'function');
  const source = {
    jobId: job.id,
    source: 'result',
    content: 'Fixed result',
    url: '',
    additional: '',
    execution: null,
    label: '현재 AI 결과',
  };
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const args = {
    source,
    additional: 'Make a checklist',
    template: null,
    execution: { profileId: 'hive', model: 'model-a', options: {} },
    storage,
  };
  const first = await flow.prepareAiFollowup(args);
  const retry = await flow.prepareAiFollowup(args);
  assert.equal(first.body.get('text'), 'Fixed result');
  assert.equal(first.body.get('url'), '');
  assert.equal(first.body.get('kind'), 'note');
  assert.equal(first.body.get('requestId'), retry.body.get('requestId'));
  const request = JSON.parse(first.body.get('aiRequest'));
  assert.equal(request.additional, 'Make a checklist');
  assert.equal(request.execution.model, 'model-a');
  const edited = await flow.prepareAiFollowup({ ...args, additional: 'Make a shorter checklist' });
  assert.notEqual(edited.body.get('requestId'), first.body.get('requestId'));
});

test('a direct followup needs an instruction while an actual task template can supply it', () => {
  assert.equal(typeof flow.followupInstructionError, 'function');
  assert.ok(flow.followupInstructionError('   ', null));
  assert.equal(flow.followupInstructionError('Summarize as tasks', null), '');
  assert.equal(flow.followupInstructionError('', { body: 'Summarize {{content}} as tasks' }), '');
});

test('followup draft restores source choice and instructions after a composer remount without changing job snapshots', () => {
  assert.equal(typeof flow.readAiFollowupDraft, 'function');
  const frozenJob = {
    id: 'job-a',
    request: {
      input: { content: 'Original', url: '' },
      additional: '',
      execution: { profileId: 'hive', model: 'model-a' },
      template: null,
    },
    result: { markdown: 'Result' },
  };
  const saved = {
    sourceType: 'original',
    additional: 'Keep this edited instruction',
    execution: { profileId: 'devin', model: 'swe-2-high' },
    selectedId: 'direct',
  };
  const restored = flow.readAiFollowupDraft(
    { getItem: () => JSON.stringify(saved) },
    'draft-key',
    frozenJob,
    'result',
    false,
  );
  assert.deepEqual(restored, saved);
  assert.equal(frozenJob.request.execution.profileId, 'hive');
  const corrupted = flow.readAiFollowupDraft(
    { getItem: () => '{bad json' },
    'draft-key',
    frozenJob,
    'result',
    false,
  );
  assert.equal(corrupted.sourceType, 'result');
  assert.equal(corrupted.additional, '');
});
