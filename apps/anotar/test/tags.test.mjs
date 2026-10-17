import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTags } from '../shared/tags.ts';

test('extractTags finds word-start #tags and skips lookalikes', () => {
  assert.deepEqual(extractTags('교토 숙소 #여행 #교토/숙소 그리고 #Travel_2026.'), ['여행', '교토/숙소', 'travel_2026']);
  assert.deepEqual(extractTags('#첫줄\n(#괄호) [#대괄호]'), ['첫줄', '괄호', '대괄호']);
  assert.deepEqual(extractTags('https://x.com/page#section a#b #1 # 제목 ## 소제목 #-x'), []);
  assert.deepEqual(extractTags('#여행 #여행 #여행-'), ['여행']);
});

test('#tag search matches memos, pages and tasks exactly; tag list counts them', async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openStore } = await import('../server/store.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'anotar-tags-'));
  const store = openStore(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const memo = store.createCapture({ kind: 'memo', text: '숙소 후보 #교토 #여행' });
  store.createCapture({ kind: 'memo', text: '#교토여행 은 다른 태그, 교토 는 그냥 글자' });
  const task = store.createTask({ title: '항공권 예약 #여행' });
  const page = store.createPage({ title: '여행 메모' });
  store.updatePage({
    id: page.id,
    expectedVersion: page.version,
    title: page.title,
    icon: '',
    document: { schemaVersion: 1, blocks: [{ id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [{ type: 'text', text: '준비물 #교토', styles: {} }], children: [] }] },
  });
  const ids = (q) => store.searchRecords({ query: q }).items.map((item) => item.id).sort();
  assert.deepEqual(ids('#교토'), [memo.id, page.id].sort());
  assert.deepEqual(ids('#여행'), [memo.id, task.id].sort());
  assert.deepEqual(store.listTags(), [
    { tag: '교토', count: 2 },
    { tag: '여행', count: 2 },
    { tag: '교토여행', count: 1 },
  ]);
});

test('pageTagText skips code spans, code blocks and link text', async () => {
  const { pageTagText } = await import('../shared/tags.ts');
  const text = (t, styles = {}) => ({ type: 'text', text: t, styles });
  const block = (content, type = 'paragraph') => ({ id: 'x', type, props: {}, content, children: [] });
  const doc = { schemaVersion: 1, blocks: [
    block([text('#', { code: true }), text('는 제목 #진짜')]),
    block([text('#코드 안')], 'codeBlock'),
    block([{ type: 'link', href: '/pages/a', content: [text('#링크')] }, text(' 뒤')]),
  ] };
  assert.deepEqual(extractTags(pageTagText(doc)), ['진짜']);
});
