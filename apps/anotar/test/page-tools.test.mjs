import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';
import { registerSearchFunctions } from '../server/searchText.mjs';
import { referencedAssetIds } from '../server/publicPage.mjs';

const paragraph = (id, text, children = []) => ({
  id,
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children,
});
const document = (...blocks) => ({ schemaVersion: 1, blocks });
const uploaded = (key = 'original-bytes', name = '페이지첨부고유어.txt', bytes = 'file') => ({
  key,
  name,
  mime: 'text/plain',
  size: Buffer.byteLength(bytes),
  sha256: createHash('sha256').update(bytes).digest('hex'),
});
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-page-tools-'));
  let store = openStore(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = openStore(dir);
      return store;
    },
  };
}
function save(store, page, doc, changes = {}) {
  return store.updatePage({ ...page, ...changes, document: doc, expectedVersion: page.version });
}
function trash(store, kind, item) {
  return store.trashRecord({
    kind,
    id: item.id,
    expectedVersion: item.version,
    operationId: randomUUID(),
  });
}
function ids(blocks) {
  return blocks.flatMap((block) => [block.id, ...ids(block.children)]);
}

test('duplicate copies one page with fresh nested IDs and durable immutable receipts', async (t) => {
  const f = await fixture(t);
  const parent = f.store.createPage({ title: '부모' });
  let source = f.store.createPage({ title: '원본', icon: '🗓', parentId: parent.id });
  const child = f.store.createPage({ title: '하위', parentId: source.id });
  source = save(
    f.store,
    source,
    document(paragraph('outer', '복제고유어', [paragraph('inner', '중첩')]), {
      id: 'child-link',
      type: 'page',
      props: { pageId: child.id },
      children: [],
    }),
  );
  const input = { pageId: source.id, expectedVersion: source.version, operationId: randomUUID() };
  const first = f.store.duplicatePage(input);
  assert.notEqual(first.item.id, source.id);
  assert.equal(first.item.parentId, parent.id);
  assert.equal(first.item.icon, '🗓');
  assert.equal(first.item.document.blocks[0].children[0].content[0].text, '중첩');
  assert.equal(first.item.document.blocks[1].props.pageId, child.id);
  assert.equal(
    ids(first.item.document.blocks).some((id) => ['outer', 'inner', 'child-link'].includes(id)),
    false,
  );
  assert.equal(f.store.listPages().filter((page) => page.parentId === first.item.id).length, 0);
  save(f.store, source, document(paragraph('later', '다른 원문')));
  const reopened = f.reopen();
  const replay = reopened.duplicatePage(input);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.item, first.item);
  assert.equal(reopened.listPages().length, 4);
  assert.throws(() => reopened.duplicatePage({ ...input, expectedVersion: 1 }), {
    name: 'PageConflictError',
  });
  assert.throws(() => reopened.savePageTemplate({ ...input, name: 'UUID 재사용' }), {
    name: 'PageConflictError',
  });
});

test('stale versions and malformed operation IDs reject creation without receipts', async (t) => {
  const { store, dir } = await fixture(t);
  const page = store.createPage();
  save(store, page, document(paragraph('updated', '최신')));
  const stale = { pageId: page.id, expectedVersion: 1, operationId: randomUUID() };
  assert.throws(() => store.duplicatePage(stale), { name: 'PageConflictError' });
  assert.throws(() => store.savePageTemplate({ ...stale, name: '템플릿' }), {
    name: 'PageConflictError',
  });
  assert.throws(
    () => store.duplicatePage({ ...stale, expectedVersion: 2, operationId: 'invalid' }),
    { name: 'PageValidationError' },
  );
  assert.throws(() => store.duplicatePage({ ...stale, expectedVersion: 2, pageId: randomUUID() }), {
    name: 'PageToolsNotFoundError',
  });
  const db = new DatabaseSync(join(dir, 'storage.sqlite'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM page_tool_operations').get().n, 0);
  db.close();
  assert.equal(store.listPages().length, 1);
});

test('templates retain snapshots and attachment references after source trash and delete idempotently', async (t) => {
  const f = await fixture(t);
  let page = f.store.createPage({ title: '템플릿 원본', icon: '📚' });
  page = f.store.attachPageFiles({
    pageId: page.id,
    expectedVersion: page.version,
    operationId: randomUUID(),
    files: [uploaded()],
  }).item;
  const assetId = page.document.blocks.find((block) => block.type === 'asset').props.assetId;
  const input = {
    pageId: page.id,
    expectedVersion: page.version,
    operationId: randomUUID(),
    name: '  내 양식  ',
  };
  const template = f.store.savePageTemplate(input).item;
  assert.equal(template.name, '내 양식');
  assert.equal(template.title, page.title);
  assert.deepEqual(template.document, page.document);
  trash(f.store, 'page', page);
  assert.ok(f.store.getAsset(assetId));
  assert.equal(f.store.searchRecords({ query: '페이지첨부고유어', type: 'file' }).items.length, 0);
  f.reopen();
  assert.equal(f.store.listPageTemplates()[0].id, template.id);
  assert.deepEqual(f.store.savePageTemplate(input).item, template);
  const parent = f.store.createPage({ title: '대상 부모' });
  const createInput = { templateId: template.id, parentId: parent.id, operationId: randomUUID() };
  const created = f.store.createPageFromTemplate(createInput);
  assert.equal(created.item.parentId, parent.id);
  assert.equal(created.item.icon, '📚');
  assert.equal(
    created.item.document.blocks.find((block) => block.type === 'asset').props.assetId,
    assetId,
  );
  assert.equal(
    ids(created.item.document.blocks).some((id) => ids(page.document.blocks).includes(id)),
    false,
  );
  assert.deepEqual(f.store.createPageFromTemplate(createInput).item, created.item);
  assert.throws(() => f.store.createPageFromTemplate({ ...createInput, parentId: null }), {
    name: 'PageConflictError',
  });
  assert.equal(f.store.deletePageTemplate({ templateId: template.id }), true);
  assert.equal(f.store.deletePageTemplate({ templateId: template.id }), false);
  assert.deepEqual(f.store.listPageTemplates(), []);
  assert.deepEqual(f.store.createPageFromTemplate(createInput).item, created.item);
  assert.throws(
    () => f.store.createPageFromTemplate({ ...createInput, operationId: randomUUID() }),
    { name: 'PageToolsNotFoundError' },
  );
});

test('selected ancestor and child move once in document order and update both versions', async (t) => {
  const { store } = await fixture(t);
  let source = store.createPage({ title: '출발' });
  source = save(
    store,
    source,
    document(
      paragraph('parent', '부모', [paragraph('child', '자식')]),
      paragraph('keep', '남김'),
      paragraph('last', '마지막'),
    ),
  );
  const target = store.createPage({ title: '목적지' });
  const input = {
    pageId: source.id,
    expectedVersion: source.version,
    targetPageId: target.id,
    targetVersion: target.version,
    blockIds: ['last', 'child', 'parent'],
    operationId: randomUUID(),
  };
  const moved = store.movePageBlocks(input);
  assert.deepEqual(
    moved.item.document.blocks.map((block) => block.id),
    ['keep'],
  );
  assert.equal(moved.target.document.blocks.length, 3);
  assert.equal(moved.target.document.blocks[1].content[0].text, '부모');
  assert.equal(moved.target.document.blocks[1].children[0].content[0].text, '자식');
  assert.equal(moved.target.document.blocks[2].content[0].text, '마지막');
  assert.equal(
    ids(moved.target.document.blocks).some((id) => ['parent', 'child', 'last'].includes(id)),
    false,
  );
  assert.equal(moved.item.version, source.version + 1);
  assert.equal(moved.target.version, target.version + 1);
  save(store, moved.target, document(paragraph('newer', '나중 편집')));
  assert.deepEqual(store.movePageBlocks(input).target, moved.target);
  assert.throws(() => store.movePageBlocks({ ...input, blockIds: ['parent'] }), {
    name: 'PageConflictError',
  });
});

test('moves reject stale targets and missing selections and roll back both pages and revisions', async (t) => {
  const { store, dir } = await fixture(t);
  let source = store.createPage({ title: '출발' });
  source = save(store, source, document(paragraph('selected', '선택')));
  const target = store.createPage({ title: '목적지' });
  const input = {
    pageId: source.id,
    expectedVersion: source.version,
    targetPageId: target.id,
    targetVersion: target.version,
    blockIds: ['selected'],
    operationId: randomUUID(),
  };
  assert.throws(() => store.movePageBlocks({ ...input, targetVersion: 9 }), {
    name: 'PageConflictError',
  });
  assert.throws(() => store.movePageBlocks({ ...input, blockIds: ['missing'] }), {
    name: 'PageValidationError',
  });
  assert.throws(
    () =>
      store.movePageBlocks({ ...input, targetPageId: source.id, targetVersion: source.version }),
    { name: 'PageValidationError' },
  );
  const db = new DatabaseSync(join(dir, 'storage.sqlite'));
  db.exec(
    "CREATE TRIGGER reject_tools_receipt BEFORE INSERT ON page_tool_operations BEGIN SELECT RAISE(ABORT,'receipt rejected'); END",
  );
  const before = store.listPageRevisions(source.id);
  assert.throws(() => store.movePageBlocks(input), /receipt rejected/);
  assert.deepEqual(store.getPage(source.id), source);
  assert.deepEqual(store.getPage(target.id), target);
  assert.deepEqual(store.listPageRevisions(source.id), before);
  db.exec('DROP TRIGGER reject_tools_receipt');
  db.close();
  const moved = store.movePageBlocks(input);
  assert.equal(moved.item.document.blocks[0].type, 'paragraph');
  assert.deepEqual(moved.item.document.blocks[0].content, []);
});

test('direct attachment owns assets without captures and replays identical bytes with fresh upload keys', async (t) => {
  const f = await fixture(t);
  const page = f.store.createPage({ title: '첨부 문서' });
  const input = {
    pageId: page.id,
    expectedVersion: page.version,
    operationId: randomUUID(),
    files: [uploaded()],
  };
  const attached = f.store.attachPageFiles(input);
  const assetId = attached.item.document.blocks[1].props.assetId;
  assert.equal(attached.item.document.blocks[1].props.display, 'file');
  assert.equal(f.store.listCaptures({ scope: 'all' }).length, 0);
  assert.equal(f.store.getAsset(assetId).pageId, page.id);
  assert.equal(f.store.getAsset(assetId).captureId, null);
  assert.equal(
    f.store.searchRecords({ query: '페이지첨부고유어', type: 'file' }).items[0].href,
    '/pages/' + page.id,
  );
  f.reopen();
  assert.deepEqual(
    f.store.attachPageFiles({ ...input, files: [uploaded('retry-bytes')] }).item,
    attached.item,
  );
  assert.throws(
    () =>
      f.store.attachPageFiles({
        ...input,
        files: [uploaded('changed-bytes', '페이지첨부고유어.txt', 'evil')],
      }),
    { name: 'PageConflictError' },
  );
  assert.throws(() => f.store.attachPageFiles({ ...input, operationId: randomUUID() }), {
    name: 'PageConflictError',
  });
  const db = new DatabaseSync(join(f.dir, 'storage.sqlite'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets').get().n, 1);
  assert.equal(db.prepare('SELECT storage_key FROM assets').get().storage_key, 'original-bytes');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  db.close();
});

test('direct attachment validates metadata and atomically rolls back failed receipts', async (t) => {
  const { store, dir } = await fixture(t);
  const page = store.createPage();
  const input = {
    pageId: page.id,
    expectedVersion: page.version,
    operationId: randomUUID(),
    files: [uploaded()],
  };
  for (const files of [
    [],
    [uploaded('../escape')],
    [{ ...uploaded(), sha256: 'invalid' }],
    [{ ...uploaded(), size: -1 }],
    Array.from({ length: 9 }, () => uploaded()),
  ])
    assert.throws(() => store.attachPageFiles({ ...input, files }), {
      name: 'PageValidationError',
    });
  const db = new DatabaseSync(join(dir, 'storage.sqlite'));
  db.exec(
    "CREATE TRIGGER reject_attachment_receipt BEFORE INSERT ON page_tool_operations BEGIN SELECT RAISE(ABORT,'attachment rollback'); END",
  );
  assert.throws(() => store.attachPageFiles(input), /attachment rollback/);
  assert.deepEqual(store.getPage(page.id), page);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets').get().n, 0);
  assert.equal(store.listPageRevisions(page.id).length, 1);
  db.close();
});

test('move shares original asset bytes and remains usable when original owner is trashed', async (t) => {
  const { store, dir } = await fixture(t);
  let source = store.createPage();
  source = store.attachPageFiles({
    pageId: source.id,
    expectedVersion: source.version,
    operationId: randomUUID(),
    files: [uploaded()],
  }).item;
  const asset = source.document.blocks[1];
  const target = store.createPage({ title: '현재 사용처' });
  const moved = store.movePageBlocks({
    pageId: source.id,
    expectedVersion: source.version,
    targetPageId: target.id,
    targetVersion: target.version,
    blockIds: [asset.id],
    operationId: randomUUID(),
  });
  trash(store, 'page', moved.item);
  assert.equal(store.getAsset(asset.props.assetId).key, 'original-bytes');
  assert.equal(
    store.searchRecords({ query: '페이지첨부고유어', type: 'file' }).items[0].href,
    '/pages/' + target.id,
  );
  const db = new DatabaseSync(join(dir, 'storage.sqlite'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets').get().n, 1);
  db.close();
});

test('moving an existing parent preserves its inert legacy references after source trash', async (t) => {
  const { store } = await fixture(t);
  const capture = store.createCapture({ kind: 'note', text: '보존할 출처' });
  let page = store.createPage({ title: '이전 문서' });
  page = save(
    store,
    page,
    document(
      paragraph('parent', '선택할 본문', [
        { id: 'legacy-ref', type: 'captureRef', props: { captureId: capture.id }, children: [] },
      ]),
    ),
  );
  trash(store, 'capture', capture);
  const target = store.createPage({ title: '새 사용처' });
  const result = store.movePageBlocks({
    pageId: page.id,
    expectedVersion: page.version,
    targetPageId: target.id,
    targetVersion: target.version,
    blockIds: ['parent'],
    operationId: randomUUID(),
  });
  assert.equal(result.target.document.blocks[1].children[0].props.captureId, capture.id);
  assert.equal(store.pageOrigins(target.id)[0].capture.text, '보존할 출처');
  assert.equal(store.getCapture(capture.id), null);
});

test('revisions record SQL writers, retain 100 versions, and restore content while preserving current hierarchy', async (t) => {
  const f = await fixture(t);
  const parent = f.store.createPage({ title: '새 부모' });
  let page = f.store.createPage({ title: '첫 제목', icon: '📅' });
  assert.equal(f.store.listPageRevisions(page.id)[0].version, 1);
  page = save(f.store, page, document(paragraph('old', '복원할 본문')), { title: '두 번째 제목' });
  const wanted = page;
  for (let index = 0; index < 101; index++)
    page = save(f.store, page, document(paragraph('next', '최신 ' + index)), { icon: '✏️' });
  const versions = f.store.listPageRevisions(page.id);
  assert.equal(versions.length, 100);
  assert.equal(versions[0].version, 103);
  assert.equal(versions.at(-1).version, 4);
  assert.equal(versions[0].document, undefined);
  assert.equal(f.store.getPageRevision(page.id, wanted.version), null);
  const revision = f.store.getPageRevision(page.id, 4);
  f.store.movePage({ id: page.id, parentId: parent.id, position: 42 });
  const input = {
    pageId: page.id,
    revisionVersion: revision.version,
    expectedVersion: page.version,
    operationId: randomUUID(),
  };
  const restored = f.store.restorePageRevision(input);
  assert.equal(restored.item.version, 104);
  assert.equal(restored.item.parentId, parent.id);
  assert.equal(restored.item.position, 42);
  assert.deepEqual(restored.item.document, revision.document);
  assert.equal(restored.item.title, revision.title);
  assert.equal(restored.item.icon, revision.icon);
  assert.equal(restored.item.createdAt, wanted.createdAt);
  f.reopen();
  assert.deepEqual(f.store.restorePageRevision(input).item, restored.item);
  assert.throws(() => f.store.restorePageRevision({ ...input, operationId: randomUUID() }), {
    name: 'PageConflictError',
  });
  const db = new DatabaseSync(join(f.dir, 'storage.sqlite'));
  registerSearchFunctions(db);
  db.prepare('UPDATE pages SET title=?,version=version+1,updated_at=? WHERE id=?').run(
    '외부 SQL',
    '2026-09-30T11:00:00.000Z',
    page.id,
  );
  assert.equal(f.store.listPageRevisions(page.id)[0].title, '외부 SQL');
  assert.equal(f.store.listPageRevisions(page.id).length, 100);
  db.close();
});

test('history only assets are privately available, absent from search and current public asset scope', async (t) => {
  const { store } = await fixture(t);
  const capture = store.createCapture({ kind: 'file', text: '', files: [uploaded()] });
  const page = store.createPage({ title: '파일 이력' });
  const imported = store.importCaptureIntoPage({
    pageId: page.id,
    operationId: randomUUID(),
    captureId: capture.id,
    copyContent: false,
    assetIds: [capture.files[0].id],
  }).item;
  trash(store, 'capture', capture);
  const current = save(store, imported, document(paragraph('current', '현재 본문')));
  assert.ok(store.getAsset(capture.files[0].id));
  assert.equal(store.searchRecords({ query: '페이지첨부고유어', type: 'file' }).items.length, 0);
  assert.deepEqual([...referencedAssetIds(current.document)], []);
  const restored = store.restorePageRevision({
    pageId: page.id,
    revisionVersion: imported.version,
    expectedVersion: current.version,
    operationId: randomUUID(),
  }).item;
  assert.deepEqual(restored.document, imported.document);
  assert.deepEqual([...referencedAssetIds(restored.document)], [capture.files[0].id]);
  assert.equal(
    store.searchRecords({ query: '페이지첨부고유어', type: 'file' }).items[0].href,
    '/pages/' + page.id,
  );
  trash(store, 'page', restored);
  assert.equal(store.listPageRevisions(page.id), null);
  assert.equal(store.getPageRevision(page.id, imported.version), null);
});

test('raw SQL revision retention releases evicted file references even without foreign key enforcement', async (t) => {
  const { store, dir } = await fixture(t);
  const capture = store.createCapture({ kind: 'file', text: '', files: [uploaded()] });
  const page = store.createPage();
  const imported = store.importCaptureIntoPage({
    pageId: page.id,
    operationId: randomUUID(),
    captureId: capture.id,
    copyContent: false,
    assetIds: [capture.files[0].id],
  }).item;
  trash(store, 'capture', capture);
  save(store, imported, document(paragraph('current', '현재')));
  assert.ok(store.getAsset(capture.files[0].id));
  const db = new DatabaseSync(join(dir, 'storage.sqlite'));
  registerSearchFunctions(db);
  db.exec('PRAGMA foreign_keys=OFF');
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 0);
  for (let index = 0; index < 100; index++)
    db.prepare('UPDATE pages SET version=version+1 WHERE id=?').run(page.id);
  assert.equal(store.listPageRevisions(page.id).length, 100);
  assert.equal(store.getPageRevision(page.id, imported.version), null);
  assert.equal(store.getAsset(capture.files[0].id), null);
  assert.equal(
    db
      .prepare('SELECT COUNT(*) AS n FROM page_revision_assets WHERE asset_id=?')
      .get(capture.files[0].id).n,
    0,
  );
  db.close();
});

test('legacy assets and page versions migrate once without changing IDs, bytes, search state or capture ownership', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-page-tools-migrate-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const db = new DatabaseSync(join(dir, 'storage.sqlite'));
  const captureId = randomUUID(),
    assetId = randomUUID(),
    pageId = randomUUID();
  db.exec(`CREATE TABLE captures(id TEXT PRIMARY KEY,kind TEXT NOT NULL,text TEXT NOT NULL DEFAULT '',url TEXT,created_at TEXT NOT NULL);
    CREATE TABLE assets(id TEXT PRIMARY KEY,capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,storage_key TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL);
    CREATE TABLE pages(id TEXT PRIMARY KEY,title TEXT NOT NULL,document TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
  db.prepare('INSERT INTO captures VALUES (?,?,?,?,?)').run(
    captureId,
    'file',
    '기존',
    null,
    '2026-09-01T00:00:00.000Z',
  );
  db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(
    assetId,
    captureId,
    'legacy-key',
    '기존첨부고유어.txt',
    'text/plain',
    9,
  );
  const doc = document({
    id: 'legacy-asset',
    type: 'asset',
    props: { assetId, display: 'file' },
    children: [],
  });
  db.prepare('INSERT INTO pages VALUES (?,?,?,?,?,?)').run(
    pageId,
    '이관고유어',
    JSON.stringify(doc),
    8,
    '2026-09-01T00:00:00.000Z',
    '2026-09-05T00:00:00.000Z',
  );
  db.close();
  let store = openStore(dir);
  assert.equal(store.getAsset(assetId).captureId, captureId);
  assert.equal(store.getAsset(assetId).key, 'legacy-key');
  assert.equal(store.getCapture(captureId).files[0].id, assetId);
  assert.equal(store.getPage(pageId).version, 8);
  assert.deepEqual(store.getPageRevision(pageId, 8).document, doc);
  assert.equal(store.listPageRevisions(pageId)[0].createdAt, '2026-09-05T00:00:00.000Z');
  const inspect = new DatabaseSync(join(dir, 'storage.sqlite'));
  const revision = inspect.prepare('SELECT revision FROM search_state').get().revision;
  inspect.close();
  store.close();
  store = openStore(dir);
  assert.equal(store.listPageRevisions(pageId).length, 1);
  const checked = new DatabaseSync(join(dir, 'storage.sqlite'));
  assert.equal(checked.prepare('SELECT revision FROM search_state').get().revision, revision);
  assert.equal(checked.prepare('PRAGMA foreign_key_check').all().length, 0);
  checked.close();
  store.close();
});

test('asset migration preserves existing search triggers, shares, AI history and import receipts', async (t) => {
  const f = await fixture(t);
  const capture = f.store.createCapture({
    kind: 'file',
    text: '기존검색고유어',
    files: [uploaded()],
  });
  const importedInput = {
    pageId: f.store.createPage({ title: '이전 문서' }).id,
    operationId: randomUUID(),
    captureId: capture.id,
    copyContent: true,
    assetIds: [capture.files[0].id],
  };
  const page = f.store.importCaptureIntoPage(importedInput).item;
  const share = f.store.createPageShare(page.id);
  const job = f.store.enqueuePageAiJob({
    pageId: page.id,
    requestId: randomUUID(),
    expectedVersion: page.version,
    aiRequest: { template: null, additional: '실행하지 않는 요청' },
  });
  const db = new DatabaseSync(join(f.dir, 'storage.sqlite'));
  registerSearchFunctions(db);
  db.exec(`PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON;
    BEGIN;
    DROP TRIGGER search_asset_insert; DROP TRIGGER search_asset_update; DROP TRIGGER search_asset_delete;
    CREATE TABLE old_assets(id TEXT PRIMARY KEY,capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,storage_key TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL);
    INSERT INTO old_assets SELECT id,capture_id,storage_key,name,mime,size FROM assets;
    DROP TABLE assets; ALTER TABLE old_assets RENAME TO assets;
    DELETE FROM search_schema_migrations WHERE name='page-assets-v1';
    COMMIT;`);
  db.close();
  f.reopen();
  assert.deepEqual(f.store.getPage(page.id), page);
  assert.equal(f.store.getCapture(capture.id).files[0].id, capture.files[0].id);
  assert.equal(
    f.store.searchRecords({ query: '기존검색고유어' }).items.some((item) => item.id === capture.id),
    true,
  );
  assert.equal(f.store.listPageShares(page.id)[0].id, share.item.id);
  assert.equal(f.store.getAiJob(job.id).id, job.id);
  assert.deepEqual(f.store.importCaptureIntoPage(importedInput).item, page);
  const attached = f.store.attachPageFiles({
    pageId: page.id,
    expectedVersion: page.version,
    operationId: randomUUID(),
    files: [uploaded('fresh-bytes', '신규첨부고유어.txt')],
  }).item;
  assert.equal(
    f.store.searchRecords({ query: '신규첨부고유어', type: 'file' }).items[0].href,
    '/pages/' + attached.id,
  );
  const checked = new DatabaseSync(join(f.dir, 'storage.sqlite'));
  registerSearchFunctions(checked);
  assert.equal(checked.prepare('PRAGMA foreign_key_check').all().length, 0);
  const assetId = capture.files[0].id;
  assert.throws(
    () => checked.prepare('UPDATE assets SET page_id=? WHERE id=?').run(page.id, assetId),
    /CHECK constraint/,
  );
  checked.close();
});

test('public server serves current direct Page assets while refusing revision/template resources and APIs', async (t) => {
  const { store, dir } = await fixture(t);
  await mkdir(join(dir, 'blobs'));
  await writeFile(join(dir, 'blobs', 'public-bytes'), 'file');
  await writeFile(join(dir, 'blobs', 'private-bytes'), 'file');
  let page = store.createPage({ title: '공유할 문서' });
  page = store.attachPageFiles({
    pageId: page.id,
    expectedVersion: page.version,
    operationId: randomUUID(),
    files: [uploaded('public-bytes', '현재.txt'), uploaded('private-bytes', '과거.txt')],
  }).item;
  const publicId = page.document.blocks[1].props.assetId,
    privateId = page.document.blocks[2].props.assetId;
  store.savePageTemplate({
    pageId: page.id,
    expectedVersion: page.version,
    operationId: randomUUID(),
    name: '비공개 양식',
  });
  page = save(store, page, document(page.document.blocks[1]));
  const share = store.createPageShare(page.id);
  const port = 9100 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['server/public.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: dir, PUBLIC_PORT: String(port), PUBLIC_HOST: '127.0.0.1' },
    stdio: 'pipe',
  });
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  });
  const base = `http://127.0.0.1:${port}`;
  let response;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      response = await fetch(base + '/s/' + share.token);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  assert.equal(response?.status, 200);
  assert.equal(
    await (await fetch(base + '/s/' + share.token + '/assets/' + publicId)).text(),
    'file',
  );
  assert.equal((await fetch(base + '/s/' + share.token + '/assets/' + privateId)).status, 404);
  for (const path of [
    '/api/page-templates',
    '/api/pages/' + page.id + '/revisions',
    '/api/pages/' + page.id + '/attachments',
  ])
    assert.equal((await fetch(base + path)).status, 404);
});
