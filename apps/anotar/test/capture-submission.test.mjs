import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareCaptureSubmission,
  forgetCaptureSubmission,
} from '../src/drafts/captureSubmission.ts';
const input = {
  kind: 'note',
  text: '정리할 글',
  url: '',
  aiEnabled: true,
  aiTemplateId: 'direct',
  aiAdditional: '',
};
const storage = () => {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
};
test('submission UUID and selected snapshot survive reload/provider-template changes; confirmed receipt is cleared', async () => {
  const local = storage();
  const a = await prepareCaptureSubmission({
    storage: local,
    key: 'x',
    input,
    files: [],
    selection: { template: null, additional: '' },
  });
  const b = await prepareCaptureSubmission({
    storage: local,
    key: 'x',
    input: { ...input },
    files: [],
    selection: { template: null, additional: 'new library state' },
  });
  assert.equal(b.requestId, a.requestId);
  assert.equal(b.selection.additional, '');
  forgetCaptureSubmission(local, 'x', 'unrelated');
  assert.equal(local.getItem('x') !== null, true);
  forgetCaptureSubmission(local, 'x', a.requestId);
  assert.equal(local.getItem('x'), null);
});
test('same filename and size with different bytes creates new submission; order and text also matter', async () => {
  const local = storage();
  const file = (text) => new File([text], 'same.txt', { type: 'text/plain' });
  const prepare = (files, extra = {}) =>
    prepareCaptureSubmission({
      storage: local,
      key: 'x',
      input: { ...input, ...extra },
      files,
      selection: { template: null, additional: '' },
    });
  const first = await prepare([file('a'), file('b')]);
  assert.equal((await prepare([file('a'), file('b')])).requestId, first.requestId);
  assert.notEqual((await prepare([file('b'), file('a')])).requestId, first.requestId);
  const next = await prepare([file('a'), file('c')]);
  assert.notEqual(next.requestId, first.requestId);
  assert.notEqual(
    (await prepare([file('a'), file('c')], { text: '다른 글' })).requestId,
    next.requestId,
  );
});
test('receipt storage failure refuses ambiguous submission and leaves draft inputs intact', async () => {
  await assert.rejects(
    prepareCaptureSubmission({
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota');
        },
      },
      key: 'x',
      input,
      files: [],
      selection: { template: null, additional: '' },
    }),
    /저장 확인/,
  );
  assert.equal(input.text, '정리할 글');
});
