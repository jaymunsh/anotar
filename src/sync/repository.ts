import { assertRemoteIdentity } from './remoteGuard';
import { reconcilePin } from './pinState';
import { putEntity } from './summaries.ts';
import { idbRequest, transaction, type StoreName } from './db.ts';
import type { SyncEntityKind, SyncOperation, SyncEntity } from '../../shared/sync.ts';
export type Value = Record<string, unknown>;
export type Entity = {
  key: string;
  workspaceId: string;
  kind: SyncEntityKind;
  id: string;
  base: Value | null;
  current: Value | null;
  remote?: SyncEntity;
  localRevision: number;
  dirty: boolean;
  localSavedAt: string;
  lastRemoteReadSeq: number;
  blobIds: string[];
  stableAt?: number;
};
export type LocalBlob = {
  key: string;
  workspaceId: string;
  id: string;
  blob: Blob;
  hash: string;
  name: string;
  mime: string;
  uploadId?: string;
};
export type Pending = {
  key: string;
  workspaceId: string;
  operation: SyncOperation;
  localRevision: number;
  dependencies: string[];
  state: 'queued' | 'sending' | 'conflict' | 'failed' | 'acked';
  attempt: number;
  nextAttemptAt: number;
  error?: string;
  errorCode?: string;
  errorStatus?: number;
};
export const keyOf = (workspaceId: string, ...parts: string[]) =>
  JSON.stringify([workspaceId, ...parts]);
const listeners = new Set<() => void>();
let channel: BroadcastChannel | undefined;
function channelInstance() {
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('leneu-sync-v1');
    channel.onmessage = () => listeners.forEach((fn) => fn());
  }
  return channel;
}
export function announceLocalChanges() {
  listeners.forEach((fn) => fn());
  channelInstance()?.postMessage('changed');
}
export function subscribeLocalChanges(listener: () => void) {
  listeners.add(listener);
  channelInstance();
  return () => {
    listeners.delete(listener);
  };
}
export async function readRecord<T>(
  name: StoreName,
  workspaceId: string,
  ...parts: string[]
): Promise<T | undefined> {
  return transaction([name], 'readonly', (tx) =>
    idbRequest(tx.objectStore(name).get(keyOf(workspaceId, ...parts))),
  );
}
export async function writeRecord(
  name: StoreName,
  workspaceId: string,
  parts: string[],
  value: Value,
) {
  await transaction([name], 'readwrite', (tx) => {
    tx.objectStore(name).put({ ...value, key: keyOf(workspaceId, ...parts), workspaceId });
  });
  announceLocalChanges();
}
export async function listRecords<T>(
  name: StoreName,
  workspaceId: string,
  limit = 100,
): Promise<T[]> {
  return transaction([name], 'readonly', (tx) =>
    idbRequest(tx.objectStore(name).index('workspace').getAll(workspaceId, limit)),
  );
}
export async function readLocalEntity({
  workspaceId,
  kind,
  id,
}: {
  workspaceId: string;
  kind: SyncEntityKind;
  id: string;
}) {
  return readRecord<Entity>('entities', workspaceId, kind, id);
}
export async function readLocalBlob(workspaceId: string, id: string) {
  return readRecord<LocalBlob>('blobs', workspaceId, id);
}
export async function saveLocalEntity({
  workspaceId,
  kind,
  id,
  value,
  blobs = [],
  pending,
}: {
  workspaceId: string;
  kind: SyncEntityKind;
  id: string;
  value: Value;
  blobs?: Omit<LocalBlob, 'key' | 'workspaceId'>[];
  pending?: Omit<Pending, 'key' | 'workspaceId' | 'localRevision'>;
}) {
  const result = await transaction(['entities', 'blobs', 'outbox'], 'readwrite', async (tx) => {
    const store = tx.objectStore('entities'),
      key = keyOf(workspaceId, kind, id),
      previous: Entity | undefined = await idbRequest(store.get(key));
    const localRevision = (previous?.localRevision ?? 0) + 1;
    const entity: Entity = {
      key,
      workspaceId,
      kind,
      id,
      base: previous?.base ?? null,
      current: structuredClone(value),
      remote: previous?.remote,
      localRevision,
      dirty: true,
      localSavedAt: new Date().toISOString(),
      lastRemoteReadSeq: previous?.lastRemoteReadSeq ?? 0,
      blobIds: blobs.length ? blobs.map((b) => b.id) : (previous?.blobIds ?? []),
    };
    putEntity(tx, entity);
    for (const blob of blobs)
      tx.objectStore('blobs').put({ ...blob, workspaceId, key: keyOf(workspaceId, blob.id) });
    if (pending)
      tx.objectStore('outbox').add({
        ...pending,
        key: keyOf(workspaceId, pending.operation.operationId),
        workspaceId,
        localRevision,
      });
    return { id, localRevision };
  });
  announceLocalChanges();
  return result;
}
export async function applyRemoteEntity(workspaceId: string, incoming: SyncEntity) {
  const changed = await transaction(['entities'], 'readwrite', async (tx) => {
    await assertRemoteIdentity(tx, workspaceId, incoming);
    const store = tx.objectStore('entities'),
      key = keyOf(workspaceId, incoming.entityKind, incoming.entityId),
      old: Entity | undefined = await idbRequest(store.get(key));
    if (
      old &&
      (incoming.readSeq < old.lastRemoteReadSeq ||
        (!incoming.tombstone && Number(incoming.version) < Number(old.base?.version)))
    )
      return false;
    const pinKey = keyOf(workspaceId, incoming.entityId);
    const pinBefore = incoming.entityKind === 'page'
      ? await idbRequest(tx.objectStore('pins').get(pinKey))
      : undefined;
    const keepPinnedBody = await reconcilePin(tx, workspaceId, old, incoming);
    const next: Entity = keepPinnedBody || old?.dirty
      ? { ...old!, remote: incoming, lastRemoteReadSeq: incoming.readSeq }
      : {
          key,
          workspaceId,
          kind: incoming.entityKind,
          id: incoming.entityId,
          base: incoming.item,
          current: incoming.item,
          localRevision: old?.localRevision ?? 0,
          dirty: false,
          localSavedAt: old?.localSavedAt ?? '',
          lastRemoteReadSeq: incoming.readSeq,
          blobIds: old?.blobIds ?? [],
        };
    const entityChanged = JSON.stringify(old) !== JSON.stringify(next);
    if (entityChanged) putEntity(tx, next);
    // Pin completeness can change after downloading an asset even when the
    // incoming document is identical. Keep that notification independent.
    const pinChanged = pinBefore && JSON.stringify(pinBefore) !==
      JSON.stringify(await idbRequest(tx.objectStore('pins').get(pinKey)));
    return entityChanged || Boolean(pinChanged);
  });
  // A read of the same record is not a new change. Announcing every cached read
  // makes record subscribers fetch it again and starts an endless refresh loop.
  if (changed) announceLocalChanges();
}
export async function migrateLegacyDrafts({ workspaceId }: { workspaceId: string }) {
  let migrated = 0,
    failed = 0;
  const keys = Object.keys(localStorage).filter((key) =>
    /^leneu:(?:(capture-draft|capture-submit|page-draft):v1:|page-draft:[a-f0-9-])/.test(key),
  );
  for (const key of keys)
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || (await readRecord('meta', workspaceId, 'legacy', key))) continue;
      const value = JSON.parse(raw);
      let files: File[] = [];
      if (key.startsWith('leneu:capture-draft:') && value.value?.fileCount) {
        const { readAttachmentDraft } = await import('../drafts/attachmentDraft.ts');
        files = await readAttachmentDraft(key.split(':').at(-1)!);
        if (files.length !== value.value.fileCount) throw Error('첨부 초안 일부를 찾지 못했어요.');
      }
      await writeRecord('meta', workspaceId, ['legacy', key], { raw, files });
      const restored = await readRecord<{ raw: string; files: File[] }>(
        'meta',
        workspaceId,
        'legacy',
        key,
      );
      if (restored?.raw !== raw || restored.files.length !== files.length)
        throw Error('초안 복구 확인에 실패했어요.');
      // Keep the legacy source until its UI has explicitly consumed the archive. Receipts are never dropped.
      migrated++;
    } catch {
      failed++;
    }
  return { migrated, failed };
}
