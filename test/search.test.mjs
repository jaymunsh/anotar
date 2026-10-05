import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';
import { createSearchStore } from '../server/search.mjs';
import { foldSearchText, registerSearchFunctions } from '../server/searchText.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-search-'));
  const store = openStore(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { store, dir };
}
const paragraph = (text) => ({
  id: randomUUID(),
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children: [],
});
const ids = (store, query, type = 'all') =>
  store.searchRecords({ query, type }).items.map((item) => item.id);
const trash = (store, record, kind) =>
  store.trashRecord({
    kind,
    id: record.id,
    expectedVersion: record.version,
    operationId: randomUUID(),
  }).item;

test('unified search finds raw memos, saved requests, page bodies and filenames with distinct types and safe paths', async (t) => {
  const { store } = await fixture(t);
  const memo = store.createCapture({
    kind: 'note',
    text: '주말여행준비 — 교토 3일',
    files: [{ key: 'one.md', name: '예약확인서.md', mime: 'text/markdown', size: 3 }],
  });
  const ai = store.createCapture({
    kind: 'note',
    text: '옛날 원문',
    aiRequest: { template: null, additional: '독립된리서치 요청' },
  });
  store.updateCapture({ id: ai.id, text: '현재 원문', expectedVersion: 1 });
  let page = store.createPage({ title: '다음 계획' });
  page = store.updatePage({
    ...page,
    expectedVersion: 1,
    document: { schemaVersion: 1, blocks: [paragraph('본문에서 가마쿠라 찾기')] },
  });
  assert.deepEqual(ids(store, '여행', 'memo'), [memo.id]);
  assert.deepEqual(ids(store, '리서치', 'ai'), [ai.id]);
  assert.equal(store.searchRecords({ query: '리서치', type: 'ai' }).items[0].label, '현재 원문');
  assert.deepEqual(ids(store, '옛날', 'ai'), [ai.id]);
  assert.deepEqual(ids(store, '가마쿠라', 'page'), [page.id]);
  const file = store.searchRecords({ query: '예약', type: 'file' }).items[0];
  assert.equal(file.id, memo.files[0].id);
  assert.equal(file.href, '/captures/' + memo.id);
  assert.equal(file.label, '예약확인서.md');
  const found = store.searchRecords({ query: '여행', type: 'memo' }).items[0];
  assert.equal(found.label, memo.text);
  assert.equal(found.type, 'memo');
  assert.equal(found.href, '/captures/' + memo.id);
  assert.deepEqual(ids(store, '교토 3'), [memo.id]);
  assert.equal(store.getCapture(ai.id).aiRequest.status, 'prepared');
});

test('bigram phrases preserve contiguous substrings, fields, Unicode NFC and literal punctuation', async (t) => {
  const { store } = await fixture(t);
  const memo = store.createCapture({
    kind: 'note',
    text: 'ab 다른말 bc\n가나 멀리 나다\n100% AND _x CAFE\u0301 😀🧭',
  });
  const exact = store.createCapture({ kind: 'note', text: 'ABC 가나다' });
  const field = store.createCapture({
    kind: 'link',
    text: '끝은 ab',
    url: 'https://bc.example/route',
  });
  assert.deepEqual(ids(store, 'abc'), [exact.id]);
  assert.deepEqual(ids(store, '가나다'), [exact.id]);
  assert.equal(ids(store, 'abbc').length, 0);
  for (const q of ['100%', 'AND', '_x', 'café', '😀🧭']) assert.deepEqual(ids(store, q), [memo.id]);
  assert.deepEqual(ids(store, 'bc.example'), [field.id]);
  assert.equal(store.searchRecords({ query: '여' }).reason, 'short_query');
  assert.equal(store.searchRecords({ query: 'a b' }).reason, 'short_query');
  assert.equal(store.searchRecords({ query: '" OR %_' }).items.length, 0);
  assert.throws(() => store.searchRecords({ query: 'x'.repeat(161) }), /160/);
  assert.throws(() => store.searchRecords({ query: Array(13).fill('교토').join(' ') }), /12/);
  assert.throws(() => store.searchRecords({ type: 'secret' }), /종류/);
});

test('nested text, links, table cells and Mermaid are indexed without block IDs or style values', async (t) => {
  const { store } = await fixture(t);
  const child = paragraph('접힌자식');
  const outer = { ...paragraph('리스트내용'), type: 'toggleListItem', children: [child] };
  const link = {
    ...paragraph(''),
    content: [
      {
        type: 'link',
        href: 'https://example.com/hidden-route',
        content: [{ type: 'text', text: '지도보기', styles: {} }],
      },
    ],
  };
  const table = {
    id: randomUUID(),
    type: 'table',
    props: {},
    content: {
      type: 'tableContent',
      rows: [
        {
          cells: [
            [{ type: 'text', text: '표안의예약', styles: {} }],
            {
              type: 'tableCell',
              content: [{ type: 'text', text: '다른셀', styles: {} }],
              props: {},
            },
          ],
        },
      ],
    },
    children: [],
  };
  const diagram = { ...paragraph('graph TD\n A[다이어그램내용] --> B[종료]'), type: 'diagram' };
  const parent = store.createPage({ title: '여행 묶음' });
  let page = store.createPage({ title: '경로 문서', parentId: parent.id });
  page = store.updatePage({
    ...page,
    expectedVersion: 1,
    document: { schemaVersion: 1, blocks: [outer, link, table, diagram] },
  });
  for (const q of [
    '접힌자식',
    '지도보기',
    'hidden-route',
    '표안의예약',
    '다른셀',
    '다이어그램내용',
  ])
    assert.deepEqual(ids(store, q, 'page'), [page.id]);
  assert.equal(ids(store, child.id, 'page').length, 0);
  assert.equal(
    store.searchRecords({ query: '접힌자식' }).items[0].context,
    '여행 묶음 / 경로 문서',
  );
  assert.ok(store.searchRecords({ query: '표안의예약' }).items[0].snippet.includes('표안의예약'));
});

test('mixed short terms use the index without folding every matching document during a query', async (t) => {
  const { store, dir } = await fixture(t);
  const found = store.createCapture({ kind: 'note', text: '교토 3일 여행' });
  store.createCapture({ kind: 'note', text: '교토 여행 하루' });
  const db = new DatabaseSync(join(dir, 'storage.sqlite'));
  try {
    const reader = createSearchStore(db);
    let folds = 0;
    db.function('search_fold', { deterministic: true }, (value) => {
      folds++;
      return foldSearchText(value);
    });
    assert.deepEqual(
      reader.searchRecords({ query: '교토 3' }).items.map((item) => item.id),
      [found.id],
    );
    assert.equal(folds, 0, 'A short constraint must not reread and fold every candidate body.');
  } finally {
    db.close();
  }
});

test('writes, conflicts, imports, rollbacks and trash transitions change the index atomically', async (t) => {
  const { store } = await fixture(t);
  const memo = store.createCapture({ kind: 'note', text: '이전문구' });
  const updated = store.updateCapture({ id: memo.id, text: '최신문구', expectedVersion: 1 });
  assert.equal(ids(store, '이전문구').length, 0);
  assert.deepEqual(ids(store, '최신문구'), [memo.id]);
  assert.throws(() => store.updateCapture({ id: memo.id, text: '실패한문구', expectedVersion: 1 }));
  assert.equal(ids(store, '실패한문구').length, 0);
  assert.throws(() =>
    store.createCapture({
      kind: 'note',
      text: '롤백된문구',
      files: [{ key: null, name: '실패파일', mime: 'text/plain', size: 1 }],
    }),
  );
  assert.equal(ids(store, '롤백된문구').length, 0);
  const parent = store.createPage({ title: '부모이름' });
  const result = store.createPageWithCapture({
    title: '하위이름',
    parentId: parent.id,
    captureImport: {
      operationId: randomUUID(),
      captureId: updated.id,
      copyContent: true,
      assetIds: [],
    },
  });
  assert.ok(ids(store, '최신문구', 'page').includes(result.item.id));
  const captureBatch = trash(store, updated, 'capture');
  assert.equal(ids(store, '최신문구', 'memo').length, 0);
  store.restoreTrash({ id: captureBatch.id, operationId: randomUUID() });
  assert.deepEqual(ids(store, '최신문구', 'memo'), [memo.id]);
  const batch = trash(store, parent, 'page');
  assert.equal(ids(store, '최신문구', 'page').length, 0);
  store.restoreTrash({ id: batch.id, operationId: randomUUID() });
  assert.ok(ids(store, '최신문구', 'page').includes(result.item.id));
  assert.throws(() =>
    store.createPageWithCapture({
      title: '실패한페이지',
      captureImport: {
        operationId: randomUUID(),
        captureId: randomUUID(),
        copyContent: true,
        assetIds: [],
      },
    }),
  );
  assert.equal(ids(store, '실패한페이지').length, 0);
});

test('formatting and inline links do not split visible words, and previews stay near long-body matches', async (t) => {
  const { store } = await fixture(t);
  const page = store.createPage({ title: '서식 문서' });
  const block = {
    ...paragraph(''),
    content: [
      { type: 'text', text: '교', styles: { bold: true } },
      {
        type: 'link',
        href: 'https://example.com/place',
        content: [{ type: 'text', text: '토', styles: {} }],
      },
      { type: 'text', text: '여행', styles: {} },
    ],
  };
  store.updatePage({
    ...page,
    expectedVersion: 1,
    document: {
      schemaVersion: 1,
      blocks: [block, paragraph('앞부분 '.repeat(1500) + '끝부분검색어 마지막')],
    },
  });
  assert.deepEqual(ids(store, '교토여행'), [page.id]);
  assert.deepEqual(ids(store, 'example.com/place'), [page.id]);
  const found = store.searchRecords({ query: '끝부분검색어' }).items[0];
  assert.ok(found.snippet.includes('끝부분검색어'));
  assert.ok(Array.from(found.snippet).length <= 182);
});

test('visible reused files remain searchable through an active page and disappear when the last reference is removed', async (t) => {
  const { store } = await fixture(t);
  const memo = store.createCapture({
    kind: 'file',
    text: '메모설명',
    files: [{ key: 'one.txt', name: '공유예약번호.txt', mime: 'text/plain', size: 3 }],
  });
  const page = store.createPage({ title: '파일을 둔 페이지' });
  const imported = store.importCaptureIntoPage({
    pageId: page.id,
    operationId: randomUUID(),
    captureId: memo.id,
    copyContent: false,
    assetIds: [memo.files[0].id],
  }).item;
  const deleted = trash(store, memo, 'capture');
  const found = store.searchRecords({ query: '예약번호', type: 'file' }).items[0];
  assert.equal(found.href, '/pages/' + page.id);
  assert.equal(found.context, page.title);
  store.updatePage({
    ...imported,
    expectedVersion: imported.version,
    document: { schemaVersion: 1, blocks: [paragraph('파일 제거')] },
  });
  assert.equal(ids(store, '예약번호', 'file').length, 0);
  store.restoreTrash({ id: deleted.id, operationId: randomUUID() });
  assert.equal(
    store.searchRecords({ query: '예약번호', type: 'file' }).items[0].href,
    '/captures/' + memo.id,
  );
});

test('20-result cursors cover tied rankings once and reset after writes, rebuild or trash', async (t) => {
  const { store } = await fixture(t);
  const memo = store.createCapture({ kind: 'note', text: '검색단어 본문' });
  const titlePage = store.createPage({ title: '검색단어' });
  assert.equal(store.searchRecords({ query: '검색단어' }).items[0].id, titlePage.id);
  for (let i = 0; i < 53; i++) store.createCapture({ kind: 'note', text: '동일검색어 문서 ' + i });
  let cursor = null;
  const resultIds = [];
  do {
    const batch = store.searchRecords({ query: '동일검색어', type: 'memo', cursor });
    assert.ok(batch.items.length <= 20);
    resultIds.push(...batch.items.map((item) => item.id));
    cursor = batch.nextCursor;
  } while (cursor);
  assert.equal(resultIds.length, 53);
  assert.equal(new Set(resultIds).size, 53);
  const first = store.searchRecords({ query: '동일검색어', type: 'memo' });
  assert.throws(
    () => store.searchRecords({ query: '다른검색어', type: 'memo', cursor: first.nextCursor }),
    /커서/,
  );
  assert.throws(
    () => store.searchRecords({ query: '동일검색어', type: 'page', cursor: first.nextCursor }),
    /커서/,
  );
  assert.throws(() => store.searchRecords({ query: '동일검색어', cursor: 'broken' }), /커서/);
  store.updateCapture({ id: memo.id, text: '수정된내용', expectedVersion: 1 });
  assert.equal(
    store.searchRecords({ query: '동일검색어', type: 'memo', cursor: first.nextCursor }).reset,
    true,
  );
  const recent = store.searchRecords({});
  assert.equal(recent.items.length, 20);
  store.rebuildSearchIndex();
  assert.equal(store.searchRecords({ cursor: recent.nextCursor }).reset, true);
});

test('existing records backfill once and restart keeps the index revision and original data', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-search-legacy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const id = randomUUID();
  const db = new DatabaseSync(join(dir, 'storage.sqlite'));
  db.exec(
    'CREATE TABLE captures (id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, url TEXT, created_at TEXT NOT NULL)',
  );
  db.prepare('INSERT INTO captures VALUES (?, ?, ?, NULL, ?)').run(
    id,
    'note',
    '기존문서내용',
    '2026-09-01T00:00:00.000Z',
  );
  db.close();
  const store = openStore(dir);
  assert.deepEqual(ids(store, '기존문서'), [id]);
  const raw = store.getCapture(id);
  const inspect = new DatabaseSync(join(dir, 'storage.sqlite'));
  const revision = inspect.prepare('SELECT revision FROM search_state').get().revision;
  assert.equal(inspect.prepare('SELECT COUNT(*) AS n FROM search_documents').get().n, 1);
  inspect.close();
  store.close();
  const reopened = openStore(dir);
  try {
    assert.deepEqual(ids(reopened, '기존문서'), [id]);
    assert.deepEqual(reopened.getCapture(id), raw);
    const check = new DatabaseSync(join(dir, 'storage.sqlite'));
    assert.equal(check.prepare('SELECT revision FROM search_state').get().revision, revision);
    check.close();
    reopened.rebuildSearchIndex();
    assert.deepEqual(ids(reopened, '기존문서'), [id]);
  } finally {
    reopened.close();
  }
});

test('a previous four-column search index upgrades atomically and preserves raw records', async (t) => {
  const { store, dir } = await fixture(t);
  const memo = store.createCapture({ kind: 'note', text: '교토 3일 오래된 색인' });
  const db = new DatabaseSync(join(dir, 'storage.sqlite'));
  registerSearchFunctions(db);
  db.exec(`BEGIN;
    DROP TRIGGER search_document_insert; DROP TRIGGER search_document_update; DROP TRIGGER search_document_delete;
    DROP TABLE search_fts;
    CREATE VIRTUAL TABLE search_fts USING fts5(title,body,url,category,content='',contentless_delete=1);
    INSERT INTO search_fts(rowid,title,body,url,category) SELECT row_id,search_tokens(title),search_tokens(body),search_tokens(url),'t'||category FROM search_documents;
    UPDATE search_meta SET version=1 WHERE id=1;
    COMMIT;`);
  db.close();
  const reopened = openStore(dir);
  try {
    assert.deepEqual(reopened.getCapture(memo.id), memo);
    assert.deepEqual(ids(reopened, '교토 3'), [memo.id]);
    const inspect = new DatabaseSync(join(dir, 'storage.sqlite'));
    assert.equal(inspect.prepare('SELECT version FROM search_meta').get().version, 3);
    inspect.close();
  } finally {
    reopened.close();
  }
});
