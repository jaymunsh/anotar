import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture, operation } from './fixtures/sync.mjs';
import { applySyncOperation } from '../server/sync/operations.mjs';
import { readSyncEntity, bootstrapSync, readSyncChanges } from '../server/sync/feed.mjs';
import { initializeSync, syncDatabase } from '../server/sync/store.mjs';
import { journalId, normalizeJournalDay, validateJournalDay } from '../shared/journal.mjs';
import { createBackup, restoreBackup } from '../server/backups.mjs';
import { openStore } from '../server/store.mjs';
import { createSyncEngine } from '../src/sync/engine.ts';

const date = '2026-10-05';
const day = () =>
  normalizeJournalDay(
    {
      priorities: [{ text: '원문', done: false }],
      brain: '',
      idea: '',
      feedback: '회고',
      plan: [],
      actual: [],
    },
    date,
  );
function journalOperation(store, value = day()) {
  const op = operation(store, 'journal.create', { date, day: value });
  op.entityId = journalId(op.workspaceId, date);
  return op;
}
test('journal uses date identity, receipts and the existing feed/bootstrap', async (t) => {
  const store = await fixture(t),
    op = journalOperation(store);
  const result = applySyncOperation(store, op);
  assert.equal(result.item.date, date);
  assert.deepEqual(result.item.day, day());
  assert.equal(result.version, 1);
  assert.equal(applySyncOperation(store, op).replayed, true);
  assert.equal(bootstrapSync(store, { kind: 'journal' }).items.length, 1);
  assert.equal(readSyncChanges(syncDatabase(store)).changes.at(-1).entityKind, 'journal');
  assert.equal(readSyncEntity(store, 'journal', op.entityId).item.day.feedback, '회고');
  assert.throws(
    () => applySyncOperation(store, { ...op, operationId: randomUUID() }),
    (e) => e.code === 'entity_exists' && e.current.day.feedback === '회고',
  );
  assert.throws(
    () => applySyncOperation(store, { ...journalOperation(store), entityId: randomUUID() }),
    (e) => e.status === 422,
  );
});
test('journal concurrent updates preserve server version and return both copies for review', async (t) => {
  const store = await fixture(t),
    op = journalOperation(store);
  applySyncOperation(store, op);
  const update = {
    ...op,
    kind: 'journal.update',
    operationId: randomUUID(),
    baseVersion: 1,
    payload: { date, day: { ...day(), feedback: '기기 A' } },
  };
  assert.equal(applySyncOperation(store, update).version, 2);
  const other = {
    ...update,
    operationId: randomUUID(),
    payload: { date, day: { ...day(), feedback: '기기 B' } },
  };
  assert.throws(
    () => applySyncOperation(store, other),
    (e) => e.code === 'version_conflict' && e.current.day.feedback === '기기 A',
  );
  assert.equal(store.getJournal(op.entityId).day.feedback, '기기 A');
  assert.equal(other.payload.day.feedback, '기기 B');
});
test('journal validation preserves old actual data and linked snapshots without changing priority', () => {
  const value = day(),
    priority = value.priorities[0];
  value.plan.push({
    id: 'p',
    start: 1380,
    end: 1440,
    title: '원문',
    kind: 'focus',
    note: '',
    missed: true,
    priorityId: priority.id,
    priorityDate: date,
    priorityTitle: '원문',
    sourcePlan: { date: '2026-10-04', id: 'old' },
  });
  value.actual.push({ id: 'a', start: 0, end: 10, title: '이전 기록', kind: 'life', note: '' });
  assert.deepEqual(validateJournalDay(value), value);
  assert.equal(priority.done, false);
  assert.throws(() => validateJournalDay({ ...value, plan: [{ ...value.plan[0], end: 1441 }] }));
  assert.throws(() => validateJournalDay({ ...value, plan: [value.plan[0], value.plan[0]] }));
  assert.throws(() => validateJournalDay({ ...value, priorities: [{ ...priority, id: '' }] }));
});
test('sync feed schema upgrade preserves sequence, original rows and subsequent triggers', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      "CREATE TABLE sync_changes(seq INTEGER PRIMARY KEY AUTOINCREMENT,entity_kind TEXT CHECK(entity_kind IN ('capture','page','task')),entity_id TEXT,action TEXT,server_time TEXT); INSERT INTO sync_changes VALUES(40,'page','original','upsert','old'); CREATE TABLE source(id TEXT); CREATE TRIGGER keep_trigger AFTER INSERT ON source BEGIN INSERT INTO sync_changes(entity_kind,entity_id,action) VALUES('page',NEW.id,'upsert'); END;",
    );
    initializeSync(db);
    assert.equal(
      db.prepare('SELECT entity_id FROM sync_changes WHERE seq=40').get().entity_id,
      'original',
    );
    db.prepare(
      "INSERT INTO sync_changes(entity_kind,entity_id,action) VALUES('journal','journal','upsert')",
    ).run();
    db.prepare("INSERT INTO source VALUES('next')").run();
    assert.equal(db.prepare('SELECT max(seq) AS seq FROM sync_changes').get().seq, 42);
    initializeSync(db);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sync_changes').get().n, 3);
  } finally {
    db.close();
  }
});
test('SQLite backup and restored epoch preserve journal JSON', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'anotar-journal-backup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = openStore(join(dir, 'live')),
    op = journalOperation(store);
  const saved = applySyncOperation(store, op).item;
  await createBackup(join(dir, 'live'), join(dir, 'backup'));
  store.close();
  await restoreBackup(join(dir, 'backup'), join(dir, 'restored'));
  const restored = openStore(join(dir, 'restored'));
  t.after(() => restored.close());
  assert.deepEqual(restored.getJournal(saved.id), saved);
  assert.notEqual(restored.syncSession().epoch, op.epoch);
});
test('existing connected devices bootstrap newly supported journals once without skipping old feed changes', async () => {
  let marked = false,
    cursor = 5,
    boots = 0;
  const read = [];
  const repository = {
    identity: async () => ({ workspaceId: 'w', epoch: 'e', cursor }),
    acquireLease: async () => ({ owner: 'test', fence: 1 }),
    renewLease: async () => true,
    releaseLease: async () => {},
    pause: async () => {},
    bootstrapDone: async () => true,
    bootstrapKindDone: async () => marked,
    markBootstrapKindDone: async () => {
      marked = true;
    },
    shouldFetchPage: async () => true,
    acceptRemote: async (incoming) => read.push(incoming.entityKind),
    advanceCursor: async (next) => {
      cursor = next;
    },
    nextOperation: async () => null,
    markSending: async () => true,
    acknowledge: async () => true,
    reject: async () => {},
    counts: async () => ({ pending: 0, conflicts: 0 }),
  };
  const transport = {
    session: async () => ({
      protocolVersion: 1,
      workspaceId: 'w',
      epoch: 'e',
      headSeq: 10,
      capabilities: ['journal.create'],
    }),
    bootstrap: async (kind) => {
      assert.equal(kind, 'journal');
      boots++;
      return { items: [{ id: 'j' }], nextAfterId: null };
    },
    fetchEntity: async (kind, id) => ({
      workspaceId: 'w',
      epoch: 'e',
      entityKind: kind,
      entityId: id,
      item: { id },
      version: 1,
      readSeq: 10,
      tombstone: false,
      missing: false,
    }),
    pullChanges: async (after) => {
      assert.ok(after === 5 || after === 10);
      return {
        epoch: 'e',
        headSeq: 10,
        nextAfter: 10,
        changes:
          after === 5 ? [{ seq: 6, entityKind: 'task', entityId: 'old', action: 'upsert' }] : [],
      };
    },
    applyOperation: async () => {
      throw Error('none');
    },
  };
  const engine = createSyncEngine({ repository, transport });
  await engine.requestSync();
  await engine.requestSync();
  assert.equal(boots, 1);
  assert.deepEqual(read, ['journal', 'task']);
  assert.equal(cursor, 10);
});
