import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createPromptStore } from '../server/prompts.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-prompts-store-'));
  let store = openStore(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
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
const draft = (item, patch = {}) => ({
  ...item,
  expectedVersion: item.version,
  expectedRevisionId: item.revisionId,
  ...patch,
});
const create = (patch = {}) => ({
  id: randomUUID(),
  name: '나의 요청',
  description: '',
  kind: 'free',
  body: '메모: {{content}}',
  archived: false,
  ...patch,
});

test('new keyword preset is backfilled into existing libraries without overwriting edited or archived presets', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const before = createPromptStore(db);
    db.exec(
      "DELETE FROM prompt_revisions WHERE template_id='research-keyword'; DELETE FROM prompt_templates WHERE id='research-keyword'",
    );
    const original = before.getPromptTemplate('research-brief');
    const changed = before.updatePromptTemplate(
      draft(original, { body: '내가 바꾼 {{content}}', archived: true }),
    );
    const libraryId = before.listPromptTemplates().libraryId;
    const after = createPromptStore(db);
    const keyword = after.getPromptTemplate('research-keyword');
    assert.ok(keyword, 'existing libraries need an actual selectable keyword preset');
    assert.equal(keyword.kind, 'research');
    assert.equal(after.listPromptTemplates().libraryId, libraryId);
    assert.deepEqual(after.getPromptTemplate('research-brief'), changed);
    const archived = after.updatePromptTemplate(
      draft(keyword, { body: '내 키워드 {{content}}', archived: true }),
    );
    assert.deepEqual(createPromptStore(db).getPromptTemplate('research-keyword'), archived);
  } finally {
    db.close();
  }
});

test('a full existing library starts without inserting another preset or changing user data', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = createPromptStore(db);
    db.exec(
      "DELETE FROM prompt_revisions WHERE template_id='research-keyword'; DELETE FROM prompt_templates WHERE id='research-keyword'",
    );
    while (store.listPromptTemplates().items.length < 200) store.createPromptTemplate(create());
    const before = store.listPromptTemplates();
    const after = createPromptStore(db);
    assert.deepEqual(after.listPromptTemplates(), before);
    assert.equal(after.getPromptTemplate('research-keyword'), null);
  } finally {
    db.close();
  }
});

test('server prompts persist across reopen, keep immutable revisions, and never revive archives', async (t) => {
  const f = await fixture(t);
  const library = f.store.listPromptTemplates();
  assert.equal(library.items.length, 4);
  const original = library.items[0];
  const edited = f.store.updatePromptTemplate(draft(original, { body: '새 본문 {{url}}' }));
  assert.equal(edited.version, 2);
  assert.notEqual(edited.revisionId, original.revisionId);
  assert.equal(f.store.getPromptRevision(original.revisionId).body, original.body);
  const created = f.store.createPromptTemplate(create());
  for (const item of f.store.listPromptTemplates().items)
    f.store.updatePromptTemplate(draft(item, { archived: true }));
  const reopened = f.reopen().listPromptTemplates();
  assert.equal(reopened.libraryId, library.libraryId);
  assert.equal(reopened.items.length, 5);
  assert.equal(reopened.items.filter((item) => !item.archived).length, 0);
  assert.equal(f.store.getPromptTemplate(created.id).name, created.name);
  assert.equal(f.store.getPromptRevision(original.revisionId).body, original.body);
});

test('stale or browser-only revisions cannot overwrite server prompts; repeated creation is idempotent', async (t) => {
  const { store } = await fixture(t);
  const input = create();
  const first = store.createPromptTemplate(input);
  assert.equal(store.createPromptTemplate(input).id, first.id);
  assert.throws(() => store.createPromptTemplate({ ...input, body: '다른 생성' }), /다른|이미/);
  const newest = store.updatePromptTemplate(draft(first, { body: '다른 브라우저 수정' }));
  const retried = store.createPromptTemplate(input);
  assert.equal(
    retried.body,
    first.body,
    'creation retries acknowledge the original saved snapshot',
  );
  assert.equal(retried.revisionId, first.revisionId);
  assert.equal(store.getPromptTemplate(first.id).revisionId, newest.revisionId);
  assert.throws(() => store.updatePromptTemplate(draft(first, { body: '늦은 초안' })), /다른|최신/);
  assert.throws(
    () => store.updatePromptTemplate(draft(newest, { expectedRevisionId: undefined })),
    /버전|가져|초안/,
  );
  assert.equal(store.getPromptTemplate(first.id).body, '다른 브라우저 수정');
});

test('invalid prompt data does not create a template or revision', async (t) => {
  const { store } = await fixture(t);
  for (const patch of [
    { name: '' },
    { name: '가'.repeat(81) },
    { body: '{{secret}}' },
    { body: 'x'.repeat(10001) },
    { kind: 'bad' },
    { archived: 'false' },
    { id: '../escape' },
    { id: 'new' },
    { id: 'constructor' },
  ]) {
    assert.throws(() => store.createPromptTemplate(create(patch)));
  }
  assert.equal(store.listPromptTemplates().items.length, 4);
});

test('imports roll back all writes when the library capacity is reached partway through', async (t) => {
  const { store } = await fixture(t);
  for (let i = 0; i < 195; i++) store.createPromptTemplate(create());
  const one = { ...create(), version: 1 },
    two = { ...create(), version: 1 };
  assert.throws(() => store.importPromptTemplates([one, two]), /200/);
  assert.equal(store.listPromptTemplates().items.length, 199);
  assert.equal(store.getPromptTemplate(one.id), null);
});

test('browser imports adopt untouched presets, preserve archived state and deduplicate retries', async (t) => {
  const { store } = await fixture(t);
  const original = store.listPromptTemplates().items[0];
  const source = {
    ...original,
    version: 7,
    revisionId: undefined,
    body: '내 브라우저 원문 {{url}}',
    archived: true,
  };
  const first = store.importPromptTemplates([source]);
  const target = store.getPromptTemplate(first.mappings[0].targetId);
  assert.equal(target.id, original.id);
  assert.equal(target.body, source.body);
  assert.equal(target.archived, true);
  assert.equal(target.version, 2, 'legacy browser versions are not fabricated server history');
  assert.equal(first.mappings[0].sourceVersion, 7);
  assert.equal(first.mappings[0].targetRevisionId, target.revisionId);
  const repeat = store.importPromptTemplates([source]);
  assert.equal(repeat.mappings[0].targetId, target.id);
  assert.equal(store.getPromptTemplate(target.id).version, 2);
  assert.equal(store.listPromptTemplates().items.length, 4);
  const newer = store.updatePromptTemplate(
    draft(target, { body: '가져온 뒤 다른 기기가 수정한 내용' }),
  );
  const replay = store.importPromptTemplates([source]);
  assert.equal(
    replay.mappings[0].targetVersion,
    target.version,
    'retry keeps the original import base',
  );
  assert.equal(replay.mappings[0].targetRevisionId, target.revisionId);
  assert.equal(replay.items.find((item) => item.id === target.id).revisionId, newer.revisionId);
  assert.throws(
    () =>
      store.updatePromptTemplate({
        ...source,
        id: target.id,
        expectedVersion: replay.mappings[0].targetVersion,
        expectedRevisionId: replay.mappings[0].targetRevisionId,
      }),
    /다른|최신/,
  );
});

test('import collisions preserve newer server bodies and rollback a partially invalid batch', async (t) => {
  const { store } = await fixture(t);
  const preset = store.listPromptTemplates().items[0];
  const latest = store.updatePromptTemplate(draft(preset, { body: '서버의 최신 내용' }));
  const source = { ...preset, body: '브라우저의 이전 내용', version: 5 };
  const imported = store.importPromptTemplates([source]);
  assert.notEqual(imported.mappings[0].targetId, latest.id);
  assert.equal(store.getPromptTemplate(latest.id).body, '서버의 최신 내용');
  assert.equal(store.getPromptTemplate(imported.mappings[0].targetId).body, source.body);
  assert.equal(
    store.importPromptTemplates([source]).mappings[0].targetId,
    imported.mappings[0].targetId,
  );
  const count = store.listPromptTemplates().items.length;
  const good = { ...create(), version: 1 };
  assert.throws(() =>
    store.importPromptTemplates([good, { ...create({ body: '{{bad}}' }), version: 1 }]),
  );
  assert.equal(store.listPromptTemplates().items.length, count);
  assert.equal(store.getPromptTemplate(good.id), null);
});


test('travel default retirement preserves prior revisions and user edited presets', () => {
  for (const edited of [false, true]) {
    const db = new DatabaseSync(':memory:');
    try {
      const before = createPromptStore(db);
      const original = before.getPromptTemplate('travel-outline');
      const active = before.updatePromptTemplate(draft(original, { archived: false, ...(edited ? { body: '내 여행 메모 {{content}}' } : {}) }));
      db.exec("DELETE FROM prompt_meta WHERE key='travel-preset-retired-v1'");
      const after = createPromptStore(db);
      const current = after.getPromptTemplate('travel-outline');
      assert.equal(current.archived, !edited);
      assert.equal(current.version, active.version + (edited ? 0 : 1));
      assert.equal(after.getPromptRevision(active.revisionId).archived, false);
      assert.equal(createPromptStore(db).getPromptTemplate('travel-outline').version, current.version);
    } finally { db.close(); }
  }
});
