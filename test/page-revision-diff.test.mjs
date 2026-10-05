import test from 'node:test';
import assert from 'node:assert/strict';
import {
  comparePageRevision,
  changedBlockFields,
  revisionBlockLabel,
} from '../shared/pageRevisionDiff.ts';
const block = (id, text, extra = {}) => ({
  id,
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children: [],
  ...extra,
});
const snapshot = (blocks, extra = {}) => ({
  title: '페이지',
  icon: '',
  document: { schemaVersion: 1, blocks },
  ...extra,
});

test('compares metadata and stable block IDs, preserving snapshots', () => {
  const before = snapshot([block('a', '과거'), block('b', '삭제')]);
  const after = snapshot([block('a', '현재'), block('c', '추가')], {
    title: '새 제목',
    icon: '✈️',
  });
  const original = structuredClone([before, after]);
  const diff = comparePageRevision(before, after);
  assert.deepEqual(diff.counts, { added: 1, removed: 1, changed: 1 });
  assert.equal(diff.titleChanged, true);
  assert.equal(diff.iconChanged, true);
  assert.deepEqual([before, after], original);
});
test('inserting or deleting a sibling does not turn unchanged following blocks into moves', () => {
  const before = snapshot([block('a', '동일'), block('b', '동일')]);
  const after = snapshot([block('x', '새 문단'), block('a', '동일'), block('b', '동일')]);
  assert.deepEqual(comparePageRevision(before, after).counts, { added: 1, removed: 0, changed: 0 });
  assert.deepEqual(comparePageRevision(after, before).counts, { added: 0, removed: 1, changed: 0 });
});
test('child changes are independent of parents, and reparenting is visible', () => {
  const before = snapshot([block('a', '부모', { children: [block('b', '이전')] })]);
  const after = snapshot([block('a', '부모'), block('b', '이후')]);
  const diff = comparePageRevision(before, after);
  assert.equal(diff.changes.length, 1);
  assert.equal(diff.changes[0].key, 'id:b');
  assert.equal(diff.changes[0].moved, true);
  assert.deepEqual(diff.changes[0].before.path, [1, 1]);
});
test('style, table cell, itinerary and reference changes survive comparison', () => {
  for (const [beforeBlock, afterBlock, field] of [
    [
      block('a', '텍스트'),
      block('a', '텍스트', { content: [{ type: 'text', text: '텍스트', styles: { bold: true } }] }),
      '본문·서식',
    ],
    [
      block('a', '', { type: 'table', content: { rows: [{ cells: [['과거']] }] } }),
      block('a', '', { type: 'table', content: { rows: [{ cells: [['현재']] }] } }),
      '본문·서식',
    ],
    [
      block('a', '', { type: 'itinerary', props: { data: '{"title":"과거"}' } }),
      block('a', '', { type: 'itinerary', props: { data: '{"title":"현재"}' } }),
      '일정',
    ],
    [
      block('a', '', { type: 'page', props: { pageId: 'old' } }),
      block('a', '', { type: 'page', props: { pageId: 'new' } }),
      '연결 페이지',
    ],
  ]) {
    assert.equal(
      comparePageRevision(snapshot([beforeBlock]), snapshot([afterBlock])).counts.changed,
      1,
    );
    assert.match(changedBlockFields(beforeBlock, afterBlock), new RegExp(field));
  }
});
test('property order is immaterial and unchanged/empty snapshots have no differences', () => {
  const a = block('a', '동일', { props: { checked: false, level: 1 } });
  const b = block('a', '동일', { props: { level: 1, checked: false } });
  assert.equal(comparePageRevision(snapshot([a]), snapshot([b])).changes.length, 0);
  assert.equal(comparePageRevision(snapshot([]), snapshot([])).changes.length, 0);
  assert.equal(revisionBlockLabel({ type: 'table' }), '표');
});
test('large comparisons have bounded display and truthful counts', () => {
  const after = snapshot(Array.from({ length: 250 }, (_, i) => block(String(i), '추가')));
  const diff = comparePageRevision(snapshot([]), after);
  assert.equal(diff.counts.added, 250);
  assert.equal(diff.changes.length, 100);
  assert.equal(diff.hiddenCount, 150);
  const huge = snapshot(Array.from({ length: 2100 }, (_, i) => block(String(i), '추가')));
  assert.equal(comparePageRevision(snapshot([]), huge).truncated, true);
});
test('reordering stable blocks is detected, and legacy blocks without IDs compare by position', () => {
  const a = block('a', 'A');
  const b = block('b', 'B');
  const reordered = comparePageRevision(snapshot([a, b]), snapshot([b, a]));
  assert.equal(reordered.counts.added, 0);
  assert.equal(reordered.counts.removed, 0);
  assert.ok(reordered.changes.every((change) => change.moved && !change.contentChanged));
  const old = { type: 'paragraph', props: {}, content: '과거' };
  const current = { ...old, content: '현재' };
  assert.equal(comparePageRevision(snapshot([old]), snapshot([current])).counts.changed, 1);
});
test('bookmark text, addresses and local thumbnail changes are labeled without fetching', () => {
  const before = {
    type: 'bookmark',
    props: { url: 'https://example.test/a', title: '이전', description: '' },
  };
  const after = {
    type: 'bookmark',
    props: {
      url: 'https://example.test/b',
      title: '현재',
      description: '설명',
      imageData: 'data:image/png;base64,fixture',
    },
  };
  const diff = comparePageRevision(snapshot([before]), snapshot([after]));
  assert.equal(diff.counts.changed, 1);
  assert.equal(revisionBlockLabel(after), '북마크');
  assert.equal(changedBlockFields(before, after), '주소 · 제목 · 설명 · 썸네일');
});
test('reparenting one block does not mark stationary old siblings as moved', () => {
  const before = snapshot([
    block('parent', '부모', { children: [block('a', '이동'), block('b', '유지')] }),
  ]);
  const after = snapshot([
    block('parent', '부모', { children: [block('b', '유지')] }),
    block('a', '이동'),
  ]);
  const diff = comparePageRevision(before, after);
  assert.equal(diff.changes.length, 1);
  assert.equal(diff.changes[0].key, 'id:a');
  assert.equal(diff.changes[0].moved, true);
});
