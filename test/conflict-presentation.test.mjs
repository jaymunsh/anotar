import test from 'node:test';
import assert from 'node:assert/strict';
import * as presentation from '../shared/conflictPresentation.ts';
const { conflictText, compareConflictPages } = presentation;
const conflictBlockSettings = (...args) => {
  assert.equal(
    typeof presentation.conflictBlockSettings,
    'function',
    'settings changes can be inspected without a duplicate body preview',
  );
  return presentation.conflictBlockSettings(...args);
};
const paragraph = (id, text, children = []) => ({
  id,
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children,
});
const page = (blocks) => ({ title: '문서', icon: '', document: { schemaVersion: 1, blocks } });
test('a paragraph leaving a nested group is shown as a move, with unchanged text', () => {
  const p = paragraph('p', '같은 문단'),
    s = page([paragraph('parent', '접힌 제목', [p])]),
    l = page([paragraph('parent', '접힌 제목'), p]);
  const original = structuredClone([s, l]);
  const result = compareConflictPages(s, l);
  assert.equal(result.moved, 1);
  assert.equal(result.contentChanged, 0);
  assert.deepEqual(result.diff.counts, { added: 0, removed: 0, changed: 1 });
  assert.deepEqual([s, l], original);
});
test('plain conflict previews include table cells, code, diagrams and child text', () => {
  const value = {
    blocks: [
      {
        type: 'table',
        content: {
          rows: [{ cells: [[{ type: 'text', text: '첫째' }], [{ type: 'text', text: '둘째' }]] }],
        },
      },
      { type: 'codeBlock', content: [{ type: 'text', text: 'const a = 1;' }] },
      { type: 'diagram', props: { source: 'graph LR; A --> B' } },
      paragraph('parent', '부모', [paragraph('child', '자식')]),
    ],
  };
  const result = conflictText(value);
  for (const text of ['첫째', '둘째', 'const a = 1;', 'graph LR; A --> B', '부모', '자식'])
    assert.ok(result.includes(text), text);
});
test('non-page conflicts and deleted server values safely skip block comparison', () => {
  assert.equal(compareConflictPages(null, page([])), null);
  assert.equal(compareConflictPages({ text: '메모' }, { text: '새 메모' }), null);
  assert.equal(conflictText(null), '');
});
test('equal text with changed styles or link targets is separated from text edits', () => {
  const before = paragraph('style', '같은 글'),
    after = structuredClone(before);
  after.content[0].styles.bold = true;
  const oldLink = {
    ...paragraph('link', ''),
    content: [
      { type: 'link', href: '/before', content: [{ type: 'text', text: '링크', styles: {} }] },
    ],
  };
  const newLink = structuredClone(oldLink);
  newLink.content[0].href = '/after';
  const result = compareConflictPages(page([before, oldLink]), page([after, newLink]));
  assert.equal(result.textChanged, 0);
  assert.equal(result.settingsChanged, 2);
  assert.equal(result.contentChanged, 2);
  assert.equal(result.textChanges.length, 0);
  assert.equal(result.otherChanges.length, 2);
  assert.deepEqual(conflictBlockSettings(before, after).changes, [
    { path: '본문 · 1 · 서식 · 굵게', before: '없음', after: '켜짐' },
  ]);
  assert.deepEqual(conflictBlockSettings(oldLink, newLink).changes, [
    { path: '본문 · 1 · 링크 주소', before: '/before', after: '/after' },
  ]);
});
test('real edits and insertions stay visible while unchanged moved blocks can be collapsed', () => {
  const before = page([
    paragraph('a', '원래'),
    paragraph('parent', '부모'),
    paragraph('move', '동일'),
  ]);
  const after = page([
    paragraph('a', '수정'),
    { ...paragraph('parent', '부모'), children: [paragraph('move', '동일')] },
    paragraph('new', '추가'),
  ]);
  const original = structuredClone([before, after]);
  const result = compareConflictPages(before, after);
  assert.equal(result.textChanged, 1);
  assert.equal(result.settingsChanged, 0);
  assert.equal(result.textChanges.length, 2);
  assert.equal(result.otherChanges.length, 1);
  assert.equal(result.moved, 1);
  assert.deepEqual([before, after], original);
});
test('table width changes expose exact settings without repeating equal table text', () => {
  const before = {
    id: 'table',
    type: 'table',
    props: {},
    content: {
      type: 'tableContent',
      columnWidths: [180, 300],
      rows: [{ cells: [[{ type: 'text', text: '같은 셀' }]] }],
    },
  };
  const after = structuredClone(before);
  after.content.columnWidths[0] = 220;
  const result = compareConflictPages(page([before]), page([after]));
  assert.equal(result.settingsChanged, 1);
  assert.equal(result.textChanged, 0);
  assert.deepEqual(conflictBlockSettings(before, after).changes, [
    { path: '본문 · 열 너비 · 1', before: '180', after: '220' },
  ]);
});
test('settings differences remain bounded with an explicit notice for omitted fields', () => {
  const before = paragraph('many', '동일'),
    after = structuredClone(before);
  after.props = Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['option' + i, i]));
  const result = conflictBlockSettings(before, after);
  assert.equal(result.changes.length, 40);
  assert.equal(result.truncated, true);
});
test('settings type changes preserve a false old value and empty container types', () => {
  const before = paragraph('setting', '동일'),
    after = structuredClone(before);
  before.props.option = false;
  after.props.option = {};
  before.props.empty = [];
  after.props.empty = {};
  assert.deepEqual(conflictBlockSettings(before, after).changes, [
    { path: '설정 · option', before: '꺼짐', after: '{}' },
    { path: '설정 · empty', before: '[]', after: '{}' },
  ]);
});
test('editor-only undefined fields do not create empty settings changes after JSON persistence', () => {
  const local = page([
    { id: 'toc', type: 'tableOfContents', props: {}, content: undefined, children: [] },
    {
      id: 'table',
      type: 'table',
      props: {},
      content: {
        type: 'tableContent',
        headerRows: undefined,
        headerCols: undefined,
        columnWidths: [undefined, 220],
        rows: [{ cells: [[{ type: 'text', text: '표 내용', styles: {} }]] }],
      },
      children: [],
    },
  ]);
  const server = JSON.parse(JSON.stringify(local));
  const result = compareConflictPages(server, local);
  assert.equal(result.settingsChanged, 0);
  assert.equal(result.diff.changes.length, 0);
  assert.deepEqual(result.diff.counts, { added: 0, removed: 0, changed: 0 });
});
test('normalization noise cannot mask a real column resize or a move', () => {
  const server = page([
    paragraph('parent', '개발 명령'),
    {
      id: 'table',
      type: 'table',
      props: {},
      content: { type: 'tableContent', columnWidths: [null, 220], rows: [] },
      children: [],
    },
    paragraph('move', '실행 명령'),
  ]);
  const local = structuredClone(server);
  local.document.blocks[1].content = {
    ...local.document.blocks[1].content,
    columnWidths: [undefined, 300],
    headerRows: undefined,
  };
  local.document.blocks[0].children = [local.document.blocks.pop()];
  const result = compareConflictPages(server, local);
  assert.equal(result.settingsChanged, 1);
  assert.equal(result.moved, 1);
  assert.equal(result.otherChanges.length, 2);
  const settings = conflictBlockSettings(server.document.blocks[1], local.document.blocks[1]);
  assert.deepEqual(settings.changes, [{ path: '본문 · 열 너비 · 2', before: '220', after: '300' }]);
});
test('move positions name the containing section and previous item instead of only block numbers', () => {
  const before = page([
    paragraph('intro', '소개'),
    paragraph('group', '개발 명령'),
    paragraph('item', '실행 명령'),
  ]);
  const after = page([
    paragraph('intro', '소개'),
    { ...paragraph('group', '개발 명령'), children: [paragraph('item', '실행 명령')] },
  ]);
  assert.equal(typeof presentation.conflictBlockPosition, 'function');
  assert.equal(presentation.conflictBlockPosition(before, [3]), '페이지 본문 · 「개발 명령」 다음');
  assert.equal(
    presentation.conflictBlockPosition(after, [2, 1]),
    '「개발 명령」 안 · 첫 번째 항목',
  );
});
