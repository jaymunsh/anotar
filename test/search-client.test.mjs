import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSearch } from '../src/search/api.ts';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const item = (type, href) => ({
  id,
  type,
  href,
  label: '결과',
  snippet: '내용',
  icon: '',
  kind: '',
  createdAt: '',
  updatedAt: '',
  context: '',
});
function fake(t, items) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ items, nextCursor: null, reset: false, reason: null }),
  });
  t.after(() => {
    globalThis.fetch = original;
  });
}
test('search client accepts extended result identities and query links', async (t) => {
  const items = [
    item('task', `/tasks?taskId=${id}`),
    item('result', `/pages/${id}?aiJob=${id}`),
    item('ocr', `/captures/${id}?ocrAsset=${id}&ocrJob=${id}`),
    item('page', `/pages/${id}`),
  ];
  fake(t, items);
  assert.deepEqual((await fetchSearch('', 'all', null, new AbortController().signal)).items, items);
});
test('search client rejects unrecognized routes and unsafe query targets', async (t) => {
  for (const href of [
    'https://other.example',
    '//other.example',
    `/pages/${id}?redirect=https://other.example`,
    `/tasks?taskId=${id}&next=/`,
  ]) {
    fake(t, [item('ocr', href)]);
    await assert.rejects(fetchSearch('', 'ocr', null, new AbortController().signal));
  }
});
