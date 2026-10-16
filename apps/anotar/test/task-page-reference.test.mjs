import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createTaskStore } from '../server/tasks.mjs';
import { fixture, operation } from './fixtures/sync.mjs';
import { applySyncOperation } from '../server/sync/operations.mjs';

test('optional page references persist, survive stage edits, and can be changed or removed', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = createTaskStore(db),
      pageId = randomUUID();
    const original = store.createTask({ title: 'Read the plan', pageId });
    assert.equal(original.pageId, pageId);
    const moved = store.updateTask({ id: original.id, expectedVersion: 1, stage: 'doing' });
    assert.equal(moved.pageId, pageId);
    const nextId = randomUUID();
    const changed = store.updateTask({ id: original.id, expectedVersion: 2, pageId: nextId });
    assert.equal(changed.pageId, nextId);
    assert.equal(changed.createdAt, original.createdAt);
    assert.throws(() => store.updateTask({ id: original.id, expectedVersion: 2, pageId: null }));
    assert.equal(store.listTasks({ stage: 'doing' }).items[0].pageId, nextId);
    createTaskStore(db);
    assert.equal(store.getTask(original.id).pageId, nextId);
    assert.equal(
      store.updateTask({ id: original.id, expectedVersion: 3, pageId: null }).pageId,
      null,
    );
  } finally {
    db.close();
  }
});

test('page references validate identifiers and keep legacy create replay fingerprints', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = createTaskStore(db),
      requestId = randomUUID();
    const old = store.createTask({ title: 'Existing task', requestId });
    assert.equal(old.pageId, null);
    assert.equal(store.createTask({ title: 'Existing task', requestId, pageId: null }).id, old.id);
    assert.throws(() =>
      store.createTask({ title: 'Existing task', requestId, pageId: randomUUID() }),
    );
    for (const pageId of ['', 'https://example.com', '../page', 7, {}]) {
      assert.throws(() => store.createTask({ title: 'Invalid link', pageId }));
      assert.throws(() => store.updateTask({ id: old.id, expectedVersion: 1, pageId }));
    }
    assert.equal(store.getTask(old.id).version, 1);
  } finally {
    db.close();
  }
});

test('legacy tasks gain a nullable reference without rewriting original rows or versions', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',due_date TEXT,position INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,version INTEGER NOT NULL DEFAULT 1,create_request_id TEXT UNIQUE,create_payload TEXT);
      INSERT INTO tasks VALUES('old','Keep me','open',NULL,0,'2026-09-01','2026-09-02',NULL,4,NULL,NULL);`);
    const store = createTaskStore(db);
    assert.equal(store.getTask('old').pageId, null);
    assert.equal(store.getTask('old').version, 4);
    assert.equal(store.getTask('old').updatedAt, '2026-09-02');
  } finally {
    db.close();
  }
});

test('sync round trips references, preserves omitted legacy fields and replays the same operation', async (t) => {
  const store = await fixture(t),
    pageId = store.createPage({ title: 'Plan' }).id;
  const create = operation(store, 'task.create', { title: 'Check plan', dueDate: null, pageId });
  const first = applySyncOperation(store, create);
  assert.equal(first.item.pageId, pageId);
  assert.deepEqual(applySyncOperation(store, create).item, { ...first.item });
  const update = {
    ...create,
    kind: 'task.update',
    operationId: randomUUID(),
    baseVersion: 1,
    payload: { title: 'Check plan', dueDate: null, stage: 'doing' },
  };
  assert.equal(applySyncOperation(store, update).item.pageId, pageId);
  const remove = {
    ...update,
    operationId: randomUUID(),
    baseVersion: 2,
    payload: { ...update.payload, pageId: null },
  };
  assert.equal(applySyncOperation(store, remove).item.pageId, null);
  const invalid = operation(store, 'task.create', {
    title: 'Bad reference',
    dueDate: null,
    pageId: 'bad',
  });
  assert.throws(
    () => applySyncOperation(store, invalid),
    (e) => e.status === 422,
  );
});
