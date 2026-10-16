import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../server/store.mjs';
import { syncDatabase } from '../../server/sync/store.mjs';
import { applySyncOperation } from '../../server/sync/operations.mjs';
export async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'leneu-sync-'));
  const store = openStore(dir);
  t.after(() => {
    store.close();
    return rm(dir, { recursive: true, force: true });
  });
  return store;
}
export function operation(
  store,
  kind = 'capture.create',
  payload = { kind: 'note', text: '오프라인 원문', url: null, uploadIds: [], aiRequest: null },
) {
  const { workspaceId, epoch } = store.syncSession();
  return {
    protocolVersion: 1,
    workspaceId,
    epoch,
    operationId: randomUUID(),
    deviceId: randomUUID(),
    entityId: randomUUID(),
    baseVersion: null,
    kind,
    payload,
  };
}
