import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';

test('archive marks a memo organized without a page; unorganize brings it back', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'anotar-archive-'));
  const store = openStore(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const memo = store.createCapture({ kind: 'note', text: '다 본 메모' });
  const operationId = randomUUID();
  const archived = store.archiveCapture({ id: memo.id, operationId });
  assert.equal(archived.replayed, false);
  assert.ok(archived.item.organizedAt);
  assert.equal(archived.item.organizedPageId, null);
  assert.equal(archived.item.organizedOperationId, operationId);
  assert.equal(store.archiveCapture({ id: memo.id, operationId }).replayed, true);
  assert.throws(() => store.archiveCapture({ id: memo.id, operationId: randomUUID() }), /이미 정리/);
  const back = store.unorganizeCapture({
    id: memo.id,
    operationId: randomUUID(),
    expectedOrganizedOperationId: operationId,
  });
  assert.equal(back.item.organizedAt, null);
});
