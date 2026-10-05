import { transaction, idbRequest } from './db';
import { keyOf, readRecord, writeRecord, announceLocalChanges } from './repository';
import { transport } from './transport';
import type { SyncEntity } from '../../shared/sync';
export type RemoteIdentity = { workspaceId: string; epoch: string };
const changed = () =>
  Object.assign(new Error('서버가 바뀌었어요. 복구 안내를 먼저 확인해 주세요.'), {
    status: 409,
    code: 'epoch_mismatch',
  });
export async function verifyRemoteAccess(workspaceId: string): Promise<RemoteIdentity> {
  const identity = await readRecord<RemoteIdentity>('meta', workspaceId, 'sync');
  if (!identity || (await readRecord('meta', workspaceId, 'recovery'))) throw changed();
  const session = await transport.session();
  if (session.workspaceId !== workspaceId || session.epoch !== identity.epoch) {
    await writeRecord('meta', workspaceId, ['recovery'], {
      reason: '서버 복원 또는 작업 공간 변경',
      createdAt: new Date().toISOString(),
    });
    const { reportRecovery } = await import('./runtime');
    reportRecovery();
    throw changed();
  }
  return { workspaceId, epoch: identity.epoch };
}
export async function assertRemoteIdentity(
  tx: IDBTransaction,
  workspaceId: string,
  incoming: Partial<RemoteIdentity>,
) {
  const identity = await idbRequest(tx.objectStore('meta').get(keyOf(workspaceId, 'sync')));
  const recovery = await idbRequest(tx.objectStore('meta').get(keyOf(workspaceId, 'recovery')));
  if (
    recovery ||
    (incoming.workspaceId && incoming.workspaceId !== workspaceId) ||
    (incoming.epoch && incoming.epoch !== identity?.epoch)
  )
    throw changed();
}
export async function cacheVerifiedRecord(
  identity: RemoteIdentity,
  store: 'meta' | 'blobs' | 'pins',
  parts: string[],
  value: Record<string, unknown>,
) {
  await transaction([store, 'meta'], 'readwrite', async (tx) => {
    await assertRemoteIdentity(tx, identity.workspaceId, identity);
    tx.objectStore(store).put({
      ...value,
      key: keyOf(identity.workspaceId, ...parts),
      workspaceId: identity.workspaceId,
    });
  });
  announceLocalChanges();
}
export async function fetchVerifiedEntity(
  workspaceId: string,
  kind: SyncEntity['entityKind'],
  id: string,
) {
  const identity = await verifyRemoteAccess(workspaceId);
  const incoming = await transport.fetchEntity(kind, id);
  if (
    (incoming.workspaceId && incoming.workspaceId !== identity.workspaceId) ||
    (incoming.epoch && incoming.epoch !== identity.epoch)
  )
    throw changed();
  await verifyRemoteAccess(workspaceId);
  return { ...incoming, ...identity };
}
