import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'leneu-trash-test-'));
  const store = openStore(directory);
  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { store, directory };
}
const remove = (store, kind, item, operationId = randomUUID()) =>
  store.trashRecord({ kind, id: item.id, expectedVersion: item.version, operationId });
const restore = (store, id, operationId = randomUUID()) => store.restoreTrash({ id, operationId });

test('memo trash hides active reads, preserves the record and bytes, and restores after restart', async (t) => {
  const { store, directory } = await fixture(t);
  await mkdir(join(directory, 'blobs'));
  await writeFile(join(directory, 'blobs', 'kept-file'), '실제 첨부');
  const original = store.createCapture({
    kind: 'file',
    text: '제목 없는 원문',
    files: [{ key: 'kept-file', name: '기록.txt', mime: 'text/plain', size: 13 }],
  });
  const result = remove(store, 'capture', original);
  assert.equal(result.item.kind, 'capture');
  assert.equal(result.item.count, 1);
  assert.equal(store.getCapture(original.id), null);
  assert.deepEqual(store.captureCounts(), { memo: 0, ai: 0 });
  assert.deepEqual(store.listCaptures({ query: '원문' }), []);
  assert.equal(
    store.updateCapture({ id: original.id, text: '늦은 변경', expectedVersion: 1 }),
    null,
  );
  assert.equal(store.getAsset(original.files[0].id), null);
  assert.equal(await readFile(join(directory, 'blobs', 'kept-file'), 'utf8'), '실제 첨부');
  const reopened = openStore(directory);
  try {
    assert.equal(reopened.listTrash().items[0].id, result.item.id);
    restore(reopened, result.item.id);
    const restored = reopened.getCapture(original.id);
    assert.deepEqual({ ...restored, version: original.version }, original);
    assert.equal(restored.version, original.version + 2);
    assert.equal(reopened.getAsset(original.files[0].id).key, 'kept-file');
    assert.equal(reopened.listTrash().counts.all, 0);
  } finally {
    reopened.close();
  }
});

test('page batches preserve hierarchy and do not restore a separately trashed child', async (t) => {
  const { store } = await fixture(t);
  const parent = store.createPage({ title: '여행', icon: '🧳' });
  const child = store.createPage({ title: '예약', parentId: parent.id });
  const grandchild = store.createPage({ title: '숙소', parentId: child.id });
  const separate = store.createPage({ title: '별도 보관', parentId: parent.id });
  const other = store.createPage({ title: '다른 기록' });
  const separateTrash = remove(store, 'page', separate);
  const parentTrash = remove(store, 'page', parent);
  assert.equal(parentTrash.item.count, 3);
  assert.deepEqual(
    store.listPages().map((item) => item.id),
    [other.id],
  );
  assert.equal(store.searchPages({ query: '예약' }).items.length, 0);
  assert.equal(store.getPage(grandchild.id), null);
  assert.throws(() => store.createPage({ parentId: parent.id }), /상위/);
  restore(store, separateTrash.item.id);
  assert.equal(store.getPage(separate.id).parentId, null);
  assert.equal(store.getPage(parent.id), null);
  restore(store, parentTrash.item.id);
  assert.equal(store.getPage(child.id).parentId, parent.id);
  assert.equal(store.getPage(grandchild.id).parentId, child.id);
  const revived = store.getPage(parent.id);
  assert.deepEqual({ ...revived, version: parent.version }, parent);
  assert.equal(store.getPage(separate.id).parentId, null);
  assert.equal(store.listTrash().counts.all, 0);
});

test('durable operation replay cannot trash a restored record or revive a later deletion', async (t) => {
  const { store, directory } = await fixture(t);
  const memo = store.createCapture({ kind: 'note', text: '지연 응답' });
  const deleteOperation = randomUUID();
  const first = remove(store, 'capture', memo, deleteOperation);
  const restoreOperation = randomUUID();
  const revived = restore(store, first.item.id, restoreOperation);
  const active = store.getCapture(memo.id);
  const reopened = openStore(directory);
  try {
    assert.deepEqual(remove(reopened, 'capture', memo, deleteOperation), first);
    assert.deepEqual(reopened.getCapture(memo.id), active);
    const second = remove(reopened, 'capture', active);
    assert.deepEqual(restore(reopened, first.item.id, restoreOperation), revived);
    assert.equal(reopened.getCapture(memo.id), null);
    assert.equal(reopened.listTrash().items[0].id, second.item.id);
    const other = reopened.createCapture({ kind: 'note', text: '다른 원문' });
    assert.throws(() => remove(reopened, 'capture', other, deleteOperation), {
      name: 'TrashConflictError',
    });
    assert.ok(reopened.getCapture(other.id));
  } finally {
    reopened.close();
  }
});

test('trash versions reject stale writes and invalid operations leave active data intact', async (t) => {
  const { store } = await fixture(t);
  const memo = store.createCapture({ kind: 'note', text: '처음' });
  const edited = store.updateCapture({
    id: memo.id,
    text: '수정된 원문',
    expectedVersion: memo.version,
  });
  assert.throws(() => remove(store, 'capture', memo), { name: 'TrashConflictError' });
  assert.deepEqual(store.getCapture(memo.id), edited);
  assert.throws(() => remove(store, 'capture', edited, 'bad'), { name: 'TrashValidationError' });
  assert.throws(
    () =>
      store.trashRecord({
        kind: 'invalid',
        id: edited.id,
        operationId: randomUUID(),
        expectedVersion: edited.version,
      }),
    { name: 'TrashValidationError' },
  );
  const moved = remove(store, 'capture', edited);
  restore(store, moved.item.id);
  assert.throws(
    () =>
      store.updateCapture({ id: memo.id, text: '오래된 편집', expectedVersion: edited.version }),
    /먼저 수정/,
  );
  const page = store.createPage({ title: '페이지' });
  const pageTrash = remove(store, 'page', page);
  assert.equal(store.updatePage({ ...page, expectedVersion: page.version }), null);
  restore(store, pageTrash.item.id);
  assert.throws(() => store.updatePage({ ...page, expectedVersion: page.version }), /먼저 수정/);
});

test('active page assets survive source memo trash and source references return on restore', async (t) => {
  const { store } = await fixture(t);
  const memo = store.createCapture({
    kind: 'file',
    text: '자료',
    files: [{ key: 'shared', name: '자료.txt', mime: 'text/plain', size: 4 }],
  });
  const page = store.createPage({ title: '문서' });
  const imported = store.importCaptureIntoPage({
    pageId: page.id,
    operationId: randomUUID(),
    captureId: memo.id,
    copyContent: true,
    assetIds: [memo.files[0].id],
  }).item;
  const memoTrash = remove(store, 'capture', memo);
  assert.ok(store.getAsset(memo.files[0].id));
  assert.deepEqual(store.getPage(page.id), imported);
  const withExistingRefs = store.updatePage({
    ...imported,
    title: '원본은 휴지통',
    expectedVersion: imported.version,
  });
  assert.ok(withExistingRefs);
  assert.throws(
    () =>
      store.importCaptureIntoPage({
        pageId: page.id,
        operationId: randomUUID(),
        captureId: memo.id,
        copyContent: false,
        assetIds: [],
      }),
    /메모/,
  );
  const pageTrash = remove(store, 'page', withExistingRefs);
  assert.equal(store.getAsset(memo.files[0].id), null);
  assert.equal(store.linkedPages(memo.id).length, 0);
  restore(store, pageTrash.item.id);
  assert.ok(store.getAsset(memo.files[0].id));
  restore(store, memoTrash.item.id);
  assert.equal(store.linkedPages(memo.id)[0].id, page.id);
  assert.equal(store.getCapture(memo.id).text, memo.text);
});

test('keyset trash pagination does not skip remaining records after an earlier item is restored', async (t) => {
  const { store } = await fixture(t);
  for (let index = 0; index < 70; index++)
    remove(store, 'capture', store.createCapture({ kind: 'note', text: `기록 ${index}` }));
  const page = store.createPage({ title: '페이지 묶음' });
  remove(store, 'page', page);
  const first = store.listTrash({ type: 'capture' });
  assert.equal(first.items.length, 50);
  assert.deepEqual(first.counts, { all: 71, capture: 70, page: 1 });
  restore(store, first.items[0].id);
  const rest = store.listTrash({ type: 'capture', cursor: first.nextCursor });
  assert.equal(rest.items.length, 20);
  assert.equal(rest.nextCursor, null);
  assert.equal(new Set([...first.items, ...rest.items].map((item) => item.id)).size, 70);
  assert.throws(() => store.listTrash({ type: 'page', cursor: first.nextCursor }), {
    name: 'TrashValidationError',
  });
});

test('legacy records remain active and sample scripts do not resurrect trash', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'leneu-legacy-trash-'));
  const db = new DatabaseSync(join(directory, 'storage.sqlite'));
  const id = randomUUID();
  db.exec(
    'CREATE TABLE captures(id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, url TEXT, created_at TEXT NOT NULL)',
  );
  db.prepare('INSERT INTO captures VALUES (?, ?, ?, NULL, ?)').run(
    id,
    'note',
    '기존 메모',
    '2026-09-26T03:30:00Z',
  );
  db.close();
  const store = openStore(directory);
  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  assert.equal(store.getCapture(id).text, '기존 메모');
  const sample = store.createCapture({
    kind: 'note',
    text: '샘플 원문',
    sampleKey: 'sample-trash',
  });
  remove(store, 'capture', sample);
  assert.equal(
    store.createCapture({ kind: 'note', text: '바꾸지 않기', sampleKey: 'sample-trash' }).id,
    sample.id,
  );
  assert.equal(store.getCapture(sample.id), null);
  const document = {
    schemaVersion: 1,
    blocks: [{ id: randomUUID(), type: 'paragraph', props: {}, content: [], children: [] }],
  };
  const samplePage = store.ensureSamplePage({ key: 'sample-trash', title: '샘플 문서', document });
  remove(store, 'page', samplePage);
  assert.equal(
    store.ensureSamplePage({ key: 'sample-trash', title: '바꾸지 않기', document }).id,
    samplePage.id,
  );
  assert.equal(store.getPage(samplePage.id), null);
  const staging = store.ensureStagingPage();
  remove(store, 'page', staging);
  assert.equal(store.getStagingPage(), null);
  assert.throws(() => store.ensureStagingPage(), /휴지통/);
});
