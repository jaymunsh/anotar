import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';

const paragraph = (text) => ({
  id: 'block-one',
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children: [],
});

test('pages keep block JSON and title after reopening the database', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-pages-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const first = openStore(dir);
  const page = first.createPage({ title: '교토 여행' });
  const document = { schemaVersion: 1, blocks: [paragraph('첫날 일정')] };
  const saved = first.updatePage({ id: page.id, title: '교토 일정', document, expectedVersion: 1 });
  assert.equal(saved.version, 2);
  first.close();

  const reopened = openStore(dir);
  t.after(() => reopened.close());
  assert.equal(reopened.getPage(page.id).title, '교토 일정');
  assert.deepEqual(reopened.getPage(page.id).document, document);
  assert.equal(reopened.listPages()[0].id, page.id);
  assert.equal(reopened.listPages()[0].document, undefined);
});

test('a stale save cannot overwrite a newer page', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-pages-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = openStore(dir);
  t.after(() => store.close());
  const page = store.createPage({ title: '초안' });
  store.updatePage({
    id: page.id,
    title: '첫 번째 저장',
    document: { schemaVersion: 1, blocks: [paragraph('첫 번째 내용')] },
    expectedVersion: 1,
  });
  assert.throws(
    () =>
      store.updatePage({
        id: page.id,
        title: '늦은 저장',
        document: { schemaVersion: 1, blocks: [paragraph('잃으면 안 되는 내용')] },
        expectedVersion: 1,
      }),
    { name: 'PageConflictError' },
  );
  assert.equal(store.getPage(page.id).title, '첫 번째 저장');
});

test('a Markdown table keeps its cells when the page is reopened', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-pages-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const first = openStore(dir);
  const page = first.createPage({ title: 'Markdown 표' });
  const cell = (text) => [{ type: 'text', text, styles: {} }];
  const table = {
    id: 'table-one',
    type: 'table',
    props: {},
    content: {
      type: 'tableContent',
      columnWidths: [120, 200],
      headerRows: 1,
      rows: [
        { cells: [cell('문법'), cell('예시')] },
        { cells: [cell('굵게'), cell('**텍스트**')] },
      ],
    },
    children: [],
  };
  first.updatePage({
    id: page.id,
    title: 'Markdown 표',
    document: { schemaVersion: 1, blocks: [table] },
    expectedVersion: 1,
  });
  first.close();
  const reopened = openStore(dir);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getPage(page.id).document.blocks[0], table);
});

test('toggle, toc and nested blocks are stored', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-pages-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = openStore(dir);
  t.after(() => store.close());
  const page = store.createPage({ title: '중첩' });
  const linked = store.createPage({ title: '하위 페이지' });
  const document = {
    schemaVersion: 1,
    blocks: [
      {
        id: 'toggle-one',
        type: 'toggleListItem',
        props: {},
        content: [{ type: 'text', text: '토글', styles: {} }],
        children: [
          {
            id: 'toggle-child',
            type: 'paragraph',
            props: {},
            content: [{ type: 'text', text: '안쪽 내용', styles: {} }],
            children: [],
          },
        ],
      },
      {
        id: 'toc-one',
        type: 'tableOfContents',
        props: {},
        children: [],
      },
      {
        id: 'page-one',
        type: 'page',
        props: { pageId: linked.id, title: '하위 페이지' },
        children: [],
      },
      {
        ...paragraph('바깥'),
        id: 'outer',
        children: [{ ...paragraph('안쪽'), id: 'inner' }],
      },
    ],
  };
  const saved = store.updatePage({
    id: page.id,
    title: '중첩',
    document,
    expectedVersion: 1,
  });
  assert.equal(saved.version, 2);
  assert.deepEqual(store.getPage(page.id).document, document);
});

test('invalid block payloads and unsafe links are rejected', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-pages-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = openStore(dir);
  t.after(() => store.close());
  const page = store.createPage({ title: '검증' });
  const update = (blocks) =>
    store.updatePage({
      id: page.id,
      title: '검증',
      document: { schemaVersion: 1, blocks },
      expectedVersion: 1,
    });
  assert.throws(() => update([{ ...paragraph('x'), type: 'script' }]), {
    name: 'PageValidationError',
  });
  assert.throws(
    () =>
      update([
        {
          ...paragraph('x'),
          content: [{ type: 'link', href: 'javascript:alert(1)', content: [] }],
        },
      ]),
    { name: 'PageValidationError' },
  );
  assert.throws(() => update([{ ...paragraph('x'), props: null }]), {
    name: 'PageValidationError',
  });
  assert.throws(
    () => update([{ id: 'page-bad', type: 'page', props: { pageId: '../etc' }, children: [] }]),
    { name: 'PageValidationError' },
  );
  assert.throws(() => update([{ ...paragraph('x'), content: { text: '깨진 블록' } }]), {
    name: 'PageValidationError',
  });
  assert.throws(
    () =>
      update([
        {
          id: 'bad-table',
          type: 'table',
          props: {},
          content: {
            type: 'tableContent',
            rows: [
              {
                cells: [[{ type: 'link', href: 'javascript:alert(1)', content: [] }]],
              },
            ],
          },
          children: [],
        },
      ]),
    { name: 'PageValidationError' },
  );
  assert.equal(store.getPage(page.id).version, 1);
});

test('page icon and parentId persist across reopen', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-pages-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const first = openStore(dir);
  const parent = first.createPage({ title: '상위' });
  const child = first.createPage({ title: '하위', icon: '🗺️', parentId: parent.id });
  assert.equal(child.icon, '🗺️');
  assert.equal(child.parentId, parent.id);

  const saved = first.updatePage({
    id: parent.id,
    title: '상위',
    icon: '📚',
    document: { schemaVersion: 1, blocks: [paragraph('본문')] },
    expectedVersion: 1,
  });
  assert.equal(saved.icon, '📚');
  first.close();

  const reopened = openStore(dir);
  t.after(() => reopened.close());
  const summary = reopened.listPages().find((item) => item.id === child.id);
  assert.equal(summary.icon, '🗺️');
  assert.equal(summary.parentId, parent.id);
  assert.equal(reopened.getPage(parent.id).icon, '📚');
});

test('icon is kept when a save does not send it, and removed by an empty string', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-pages-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = openStore(dir);
  t.after(() => store.close());
  const page = store.createPage({ title: '아이콘', icon: '🌱' });

  const withoutIcon = store.updatePage({
    id: page.id,
    title: '아이콘',
    document: { schemaVersion: 1, blocks: [paragraph('a')] },
    expectedVersion: 1,
  });
  assert.equal(withoutIcon.icon, '🌱');

  const cleared = store.updatePage({
    id: page.id,
    title: '아이콘',
    icon: '',
    document: { schemaVersion: 1, blocks: [paragraph('b')] },
    expectedVersion: 2,
  });
  assert.equal(cleared.icon, '');
});

test('invalid icon and parentId are rejected', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-pages-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = openStore(dir);
  t.after(() => store.close());
  assert.throws(() => store.createPage({ title: 'x', icon: 42 }), {
    name: 'PageValidationError',
  });
  assert.throws(
    () =>
      store.createPage({
        title: 'x',
        icon: '이모지가 아니라 아주 긴 문자열 123456789012345678901234567890',
      }),
    {
      name: 'PageValidationError',
    },
  );
  assert.throws(() => store.createPage({ title: 'x', parentId: '../etc' }), {
    name: 'PageValidationError',
  });
  assert.throws(() => store.createPage({ title: 'x', parentId: 'abcd-1234' }), {
    name: 'PageValidationError',
    message: '상위 페이지를 찾을 수 없습니다.',
  });
});

test('movePage reorders and reparents pages, and rejects cycles', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-pages-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = openStore(dir);
  t.after(() => store.close());
  const a = store.createPage({ title: 'A' });
  const b = store.createPage({ title: 'B' });
  const c = store.createPage({ title: 'C' });
  // 새 페이지는 같은 단계의 끝에 붙어 만들 순서를 따른다
  const roots = store.listPages();
  assert.deepEqual(
    roots.map((page) => page.id),
    [a.id, b.id, c.id],
  );

  // A를 C 안쪽 하위로 이동
  const moved = store.movePage({ id: a.id, parentId: c.id, position: 5 });
  assert.equal(moved.parentId, c.id);
  assert.equal(moved.position, 5);

  // 자기 자신이나 자손 안으로는 옮길 수 없다
  assert.throws(() => store.movePage({ id: c.id, parentId: c.id, position: 0 }), {
    name: 'PageValidationError',
  });
  assert.throws(() => store.movePage({ id: c.id, parentId: a.id, position: 0 }), {
    name: 'PageValidationError',
  });
  // 없는 페이지는 null, 잘못된 위치는 검증 오류
  assert.equal(store.movePage({ id: 'abcd-1234', parentId: null, position: 0 }), null);
  assert.throws(() => store.movePage({ id: b.id, parentId: null, position: 'x' }), {
    name: 'PageValidationError',
  });

  // B를 맨 위로 옮기면 목록 맨 앞에 온다
  const top = store.movePage({ id: b.id, parentId: null, position: -1 });
  assert.equal(top.parentId, null);
  assert.equal(store.listPages()[0].id, b.id);
});
