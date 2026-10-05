import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { syncDatabase } from '../server/sync/store.mjs';
import { applySyncOperation } from '../server/sync/operations.mjs';
import { fixture, operation } from './fixtures/sync.mjs';
const status = (code, reason) => (error) =>
  error.status === code && (!reason || error.code === reason);
test('stable create UUID, lost acknowledgement replay, immutable payload and timestamp', async (t) => {
  const store = await fixture(t),
    db = syncDatabase(store),
    op = operation(store);
  op.payload.clientCreatedAt = '2026-09-29T00:00:00.000Z';
  const first = applySyncOperation(store, op);
  assert.equal(first.item.id, op.entityId);
  for (let n = 0; n < 5; n++) {
    const result = applySyncOperation(store, structuredClone(op));
    assert.equal(result.replayed, true);
    assert.deepEqual(result.item, first.item);
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM sync_receipts').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM captures').get().n, 1);
  assert.equal(first.item.clientCreatedAt, op.payload.clientCreatedAt);
  assert.notEqual(first.item.createdAt, op.payload.clientCreatedAt);
  assert.throws(
    () => applySyncOperation(store, { ...op, payload: { ...op.payload, text: 'changed' } }),
    status(409, 'payload_mismatch'),
  );
  assert.throws(
    () => applySyncOperation(store, { ...op, operationId: randomUUID() }),
    status(409, 'entity_exists'),
  );
  const edit = {
    ...op,
    kind: 'capture.update',
    operationId: randomUUID(),
    baseVersion: 1,
    payload: { text: 'edited', url: null },
  };
  assert.equal(applySyncOperation(store, edit).version, 2);
  assert.throws(
    () => applySyncOperation(store, { ...edit, operationId: randomUUID() }),
    status(409, 'version_conflict'),
  );
});
test('receipt failure rolls back domain row and change log', async (t) => {
  const store = await fixture(t),
    db = syncDatabase(store);
  db.exec(
    "CREATE TRIGGER reject_receipt BEFORE INSERT ON sync_receipts BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END",
  );
  assert.throws(() => applySyncOperation(store, operation(store)), /fixture receipt failure/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM captures').get().n, 0);
  assert.equal(store.syncSession().headSeq, 0);
});
test('validation, protocol, identity, epoch and task stale writes are explicit', async (t) => {
  const store = await fixture(t),
    op = operation(store, 'task.create', { title: '할 일', dueDate: null });
  assert.throws(() => applySyncOperation(store, { ...op, protocolVersion: 2 }), status(426));
  assert.throws(
    () => applySyncOperation(store, { ...op, epoch: randomUUID() }),
    status(409, 'epoch_mismatch'),
  );
  assert.throws(
    () => applySyncOperation(store, { ...op, workspaceId: randomUUID() }),
    status(409, 'workspace_mismatch'),
  );
  assert.throws(
    () => applySyncOperation(store, { ...op, payload: { title: '', dueDate: null } }),
    status(422),
  );
  const result = applySyncOperation(store, op);
  assert.equal(result.item.id, op.entityId);
  const edit = {
    ...op,
    kind: 'task.update',
    operationId: randomUUID(),
    baseVersion: 1,
    payload: { title: '할 일', dueDate: null, stage: 'done' },
  };
  assert.equal(applySyncOperation(store, edit).item.stage, 'done');
  assert.throws(
    () => applySyncOperation(store, { ...edit, operationId: randomUUID() }),
    status(409),
  );
});
test('discriminated payload requires task fields and attachments for file/image creation', async (t) => {
  const store = await fixture(t);
  for (const [kind, payload] of [
    ['task.update', { title: 't' }],
    ['capture.create', { kind: 'image', text: 'x', url: null, uploadIds: [], aiRequest: null }],
  ]) {
    const op = operation(store, kind, payload);
    if (kind === 'task.update') {
      const created = store.createTask({ title: 'existing' });
      op.entityId = created.id;
      op.baseVersion = 1;
    }
    assert.throws(
      () => applySyncOperation(store, op),
      (e) => e.status === 422,
    );
  }
});
