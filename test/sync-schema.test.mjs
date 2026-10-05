import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeSync, getSyncSession } from '../server/sync/store.mjs';
import { openStore } from '../server/store.mjs';

test('sync initialization is additive and keeps identity on repeated initialization', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE captures(id TEXT PRIMARY KEY, text TEXT); INSERT INTO captures VALUES('old','그대로');
      CREATE TABLE pages(id TEXT PRIMARY KEY, document TEXT); INSERT INTO pages VALUES('page','{"schemaVersion":1,"blocks":[]}');
      CREATE TABLE tasks(id TEXT PRIMARY KEY, title TEXT); INSERT INTO tasks VALUES('task','할 일');
      CREATE TABLE assets(id TEXT PRIMARY KEY, name TEXT); INSERT INTO assets VALUES('asset','photo.png');`);
    const before = ['captures', 'pages', 'tasks', 'assets'].map((table) =>
      db.prepare(`SELECT * FROM ${table}`).all(),
    );
    initializeSync(db);
    const first = getSyncSession(db);
    assert.match(first.workspaceId, /^[0-9a-f-]{36}$/);
    assert.match(first.epoch, /^[0-9a-f-]{36}$/);
    assert.equal(first.protocolVersion, 1);
    assert.equal(first.headSeq, 0);
    assert.deepEqual(first.capabilities, []);
    initializeSync(db);
    const second = getSyncSession(db);
    assert.equal(second.workspaceId, first.workspaceId);
    assert.equal(second.epoch, first.epoch);
    assert.deepEqual(
      ['captures', 'pages', 'tasks', 'assets'].map((table) =>
        db.prepare(`SELECT * FROM ${table}`).all(),
      ),
      before,
    );
    for (const table of ['sync_meta', 'sync_changes', 'sync_receipts', 'sync_uploads'])
      assert.ok(db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table));
  } finally {
    db.close();
  }
});

test('empty standalone schema and actual store restart preserve sync identity and user rows', async (t) => {
  const empty = new DatabaseSync(':memory:');
  initializeSync(empty);
  assert.equal(getSyncSession(empty).headSeq, 0);
  empty.close();
  const dir = await mkdtemp(join(tmpdir(), 'leneu-sync-schema-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let store = openStore(dir);
  const note = store.createCapture({
    kind: 'note',
    text: '原本',
    files: [{ key: 'file', name: 'p.png', mime: 'image/png', size: 3 }],
  });
  const page = store.createPage({ title: 'keep' });
  const task = store.createTask({ title: 'do' });
  const identity = store.syncSession();
  store.close();
  store = openStore(dir);
  t.after(() => store.close());
  assert.equal(store.syncSession().workspaceId, identity.workspaceId);
  assert.equal(store.syncSession().epoch, identity.epoch);
  assert.deepEqual(store.getCapture(note.id), note);
  assert.deepEqual(store.getPage(page.id), page);
  assert.equal(store.getTask(task.id).title, task.title);
});
