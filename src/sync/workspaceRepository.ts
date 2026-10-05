import { assertRemoteIdentity } from './remoteGuard';
import { reconcilePin } from './pinState';
import { putEntity } from './summaries.ts';
import type { SyncOperation } from '../../shared/sync.ts';
import { idbRequest, transaction, type StoreName } from './db.ts';
import {
  announceLocalChanges,
  keyOf,
  readRecord,
  listRecords,
  readLocalEntity,
  type Entity,
  type Pending,
  type Value,
} from './repository.ts';
import type { EngineRepository, Identity, Lease } from './engine.ts';
import { conflictCopies, shouldApplyRemote } from './conflicts.ts';
type LeaseRow = Lease & { key: string; workspaceId: string; expiresAt: number };
export function pageDependencies(entity: Entity, heads: Pending[]): string[] {
  if (entity.kind !== 'page') return [];
  const refs = new Set<string>();
  if (typeof entity.current?.parentId === 'string') refs.add(entity.current.parentId);
  function visit(blocks: unknown) {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      if (block.type === 'page' && typeof block.props?.pageId === 'string')
        refs.add(block.props.pageId);
      visit(block.children);
    }
  }
  visit((entity.current?.document as { blocks?: unknown })?.blocks);
  return heads
    .filter(
      (head) =>
        head.operation.kind === 'page.create' &&
        refs.has(head.operation.entityId) &&
        head.operation.entityId !== entity.id,
    )
    .map((head) => head.operation.operationId);
}
export function operationForEntity(
  entity: Entity,
  identity: Identity,
  deviceId: string,
): SyncOperation {
  const value = entity.current!;
  const create = !entity.base,
    kind = `${entity.kind}.${create ? 'create' : 'update'}`;
  let payload: Value;
  if (entity.kind === 'capture')
    payload = create
      ? {
          kind: value.kind,
          text: value.text ?? '',
          url: value.url ?? null,
          uploadIds: value.uploadIds ?? [],
          aiRequest: null,
          clientCreatedAt: value.clientCreatedAt,
        }
      : { text: value.text ?? '', url: value.url ?? null };
  else if (entity.kind === 'task')
    payload = create
      ? {
          title: value.title,
          dueDate: value.dueDate ?? null,
          pageId: value.pageId ?? null,
          clientCreatedAt: value.clientCreatedAt,
        }
      : { title: value.title, dueDate: value.dueDate ?? null, stage: value.stage ?? 'todo', pageId: value.pageId ?? null };
  else if (entity.kind === 'journal')
    payload = { date: value.date, day: value.day, ...(create ? { clientCreatedAt:value.clientCreatedAt } : {}) };
  else
    payload = create
      ? {
          title: value.title,
          icon: value.icon ?? '',
          parentId: value.parentId ?? null,
          document: value.document,
          clientCreatedAt: value.clientCreatedAt,
        }
      : { title: value.title, icon: value.icon ?? '', document: value.document };
  for (const key of Object.keys(payload)) if (payload[key] === undefined) delete payload[key];
  return {
    protocolVersion: 1,
    workspaceId: identity.workspaceId,
    epoch: identity.epoch,
    deviceId,
    operationId: crypto.randomUUID(),
    entityId: entity.id,
    kind,
    baseVersion: create ? null : Number(entity.base!.version),
    payload,
  } as unknown as SyncOperation;
}
export function workspaceRepository(
  workspaceId: string,
  deviceId: string,
  clock = Date.now,
): EngineRepository {
  const leaseKey = keyOf(workspaceId, 'engine');
  const write = async <T>(
    names: StoreName[],
    lease: Lease,
    callback: (tx: IDBTransaction) => Promise<T> | T,
  ) => {
    const result = await transaction(
      [...new Set<StoreName>(['leases', ...names])],
      'readwrite',
      async (tx) => {
        const held: LeaseRow | undefined = await idbRequest(tx.objectStore('leases').get(leaseKey));
        if (
          !held ||
          held.owner !== lease.owner ||
          held.fence !== lease.fence ||
          held.expiresAt <= clock()
        )
          throw new Error('동기화 실행 권한이 다른 창으로 바뀌었어요.');
        return callback(tx);
      },
    );
    announceLocalChanges();
    return result;
  };
  const identity = async () => {
    const state = await readRecord<Identity>('meta', workspaceId, 'sync');
    if (!state) throw Error('작업 공간 연결 정보가 없어요.');
    return state;
  };
  const adapter: EngineRepository = {
    identity,
    acquireLease: async (owner, now) =>
      transaction(['leases'], 'readwrite', async (tx) => {
        const store = tx.objectStore('leases'),
          old: LeaseRow | undefined = await idbRequest(store.get(leaseKey));
        if (old && old.expiresAt > now && old.owner !== owner) return null;
        const lease = {
          key: leaseKey,
          workspaceId,
          owner,
          fence: (old?.fence ?? 0) + 1,
          expiresAt: now + 30000,
        };
        store.put(lease);
        return { owner, fence: lease.fence };
      }),
    renewLease: async (lease, now) =>
      transaction(['leases'], 'readwrite', async (tx) => {
        const store = tx.objectStore('leases'),
          old: LeaseRow | undefined = await idbRequest(store.get(leaseKey));
        if (!old || old.fence !== lease.fence || old.owner !== lease.owner || old.expiresAt <= now)
          return false;
        store.put({ ...old, expiresAt: now + 30000 });
        return true;
      }),
    releaseLease: async (lease) => {
      await transaction(['leases'], 'readwrite', async (tx) => {
        const store = tx.objectStore('leases'),
          old: LeaseRow | undefined = await idbRequest(store.get(leaseKey));
        if (old?.fence === lease.fence && old.owner === lease.owner)
          store.put({ ...old, owner: '', expiresAt: 0 });
      });
    },
    pause: async (reason) => {
      await transaction(['meta'], 'readwrite', (tx) => {
        tx.objectStore('meta').put({
          key: keyOf(workspaceId, 'recovery'),
          workspaceId,
          reason,
          createdAt: new Date().toISOString(),
        });
      });
    },
    isPaused: async () => Boolean(await readRecord('meta', workspaceId, 'recovery')),
    bootstrapDone: async () => Boolean(await readRecord('meta', workspaceId, 'bootstrapped')),
    bootstrapKindDone: async (kind) => Boolean(await readRecord('meta',workspaceId,'bootstrappedKind',kind)),
    markBootstrapKindDone: async (kind,lease) => {
      await write(['meta'],lease,tx => { tx.objectStore('meta').put({ key:keyOf(workspaceId,'bootstrappedKind',kind),workspaceId,ready:true }); });
    },
    markBootstrapDone: async (cursor, lease) => {
      await write(['meta'], lease, async (tx) => {
        const store = tx.objectStore('meta'),
          old = await idbRequest(store.get(keyOf(workspaceId, 'sync')));
        store.put({ ...old, cursor });
        store.put({ key: keyOf(workspaceId, 'bootstrapped'), workspaceId, ready: true });
      });
    },
    shouldFetchPage: async (id) => {
      const entity = await readLocalEntity({ workspaceId, kind: 'page', id });
      return Boolean(
        entity?.dirty || entity?.current?.document || (await readRecord('pins', workspaceId, id)),
      );
    },
    acceptRemote: async (incoming, lease) => {
      await write(['entities'], lease, async (tx) => {
        await assertRemoteIdentity(tx, workspaceId, incoming);
        const store = tx.objectStore('entities'),
          key = keyOf(workspaceId, incoming.entityKind, incoming.entityId),
          old: Entity | undefined = await idbRequest(store.get(key));
        if (!shouldApplyRemote(old, incoming)) return;
        if (await reconcilePin(tx, workspaceId, old, incoming)) {
          putEntity(tx, { ...old!, remote: incoming, lastRemoteReadSeq: incoming.readSeq });
          return;
        }
        if (old?.dirty) {
          putEntity(tx, { ...old, remote: incoming, lastRemoteReadSeq: incoming.readSeq });
          return;
        }
        putEntity(tx, {
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
        });
      });
    },
    advanceCursor: async (cursor, lease) => {
      if ((await identity()).cursor === cursor) return;
      await write(['meta'], lease, async (tx) => {
        const store = tx.objectStore('meta'),
          old = await idbRequest(store.get(keyOf(workspaceId, 'sync')));
        store.put({ ...old, cursor });
      });
    },
    nextOperation: async (now, capabilities) => {
      const queue = await listRecords<Pending>('outbox', workspaceId, 10000);
      for (const pending of queue) {
        if (
          !['queued', 'sending'].includes(pending.state) ||
          pending.nextAttemptAt > now ||
          !capabilities.includes(pending.operation.kind)
        )
          continue;
        const blockers = queue.some(
          (other) =>
            other.operation.entityId === pending.operation.entityId &&
            other.operation.operationId !== pending.operation.operationId &&
            ['conflict', 'failed', 'sending'].includes(other.state),
        );
        if (blockers) continue;
        let ready = true;
        for (const dependency of pending.dependencies)
          if (!(await readRecord('meta', workspaceId, 'ack', dependency))) {
            ready = false;
            break;
          }
        if (ready) return pending;
      }
      return null;
    },
    markSending: async (pending, lease) => {
      return write(['outbox'], lease, async (tx) => {
        const store = tx.objectStore('outbox'),
          current: Pending | undefined = await idbRequest(store.get(pending.key));
        if (
          !current ||
          !['queued', 'sending'].includes(current.state) ||
          current.nextAttemptAt > clock()
        )
          return false;
        store.put({ ...current, state: 'sending' });
        return true;
      });
    },
    acknowledge: async (pending, result, lease) => {
      try {
        return await write(['entities', 'outbox', 'meta', 'blobs'], lease, async (tx) => {
          const store = tx.objectStore('entities'),
            key = keyOf(
              workspaceId,
              pending.operation.kind.split('.')[0],
              pending.operation.entityId,
            ),
            old: Entity | undefined = await idbRequest(store.get(key));
          tx.objectStore('meta').put({
            key: keyOf(workspaceId, 'ack', pending.operation.operationId),
            workspaceId,
            result,
            at: new Date().toISOString(),
          });
          tx.objectStore('outbox').delete(pending.key);
          if (result.workflow) {
            const kind =
              pending.operation.kind === 'ai.submit'
                ? pending.operation.payload.sourceKind
                : 'capture';
            const sourceKey = keyOf(workspaceId, kind, pending.operation.entityId);
            const entity: Entity | undefined = await idbRequest(store.get(sourceKey));
            if (entity && !entity.dirty)
              putEntity(tx, { ...entity, base: result.item, current: result.item });
            return true;
          }
          if (old) {
            if (Array.isArray(result.item.files)) {
              for (let i = 0; i < result.item.files.length; i++) {
                const localId = old.blobIds[i],
                  assetId = result.item.files[i].id;
                if (!localId || !assetId) continue;
                const blob = await idbRequest(
                  tx.objectStore('blobs').get(keyOf(workspaceId, localId)),
                );
                if (blob)
                  tx.objectStore('blobs').put({
                    ...blob,
                    id: assetId,
                    key: keyOf(workspaceId, assetId),
                  });
              }
            }
            const newer = old.localRevision > pending.localRevision;
            const remote = old.remote?.tombstone
              ? null
              : old.remote && Number(old.remote.version) > result.version
                ? old.remote.item
                : result.item;
            const entity = {
              ...old,
              base: newer ? result.item : remote,
              current: newer ? old.current : remote,
              dirty: newer,
              remote: newer ? old.remote : undefined,
            };
            putEntity(tx, entity);
            const remaining: Pending[] = await idbRequest(
              tx.objectStore('outbox').index('workspace').getAll(workspaceId),
            );
            if (
              newer &&
              !remaining.some(
                (p) =>
                  p.operation.entityId === entity.id &&
                  /\.(create|update)$/.test(p.operation.kind) &&
                  p.localRevision >= entity.localRevision,
              )
            ) {
              const state = await idbRequest(
                  tx.objectStore('meta').get(keyOf(workspaceId, 'sync')),
                ),
                operation = operationForEntity(entity, state, deviceId);
              tx.objectStore('outbox').add({
                key: keyOf(workspaceId, operation.operationId),
                workspaceId,
                operation,
                localRevision: entity.localRevision,
                dependencies: pageDependencies(
                  entity,
                  await idbRequest(tx.objectStore('outbox').index('workspace').getAll(workspaceId)),
                ),
                state: 'queued',
                attempt: 0,
                nextAttemptAt: entity.stableAt ?? 0,
              });
            }
          }
          return true;
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes('실행 권한')) return false;
        throw error;
      }
    },
    reject: async (pending, state, cause, nextAttemptAt, lease) => {
      await write(['outbox', 'entities', 'conflicts'], lease, async (tx) => {
        const error = cause as {
          message?: string;
          code?: string;
          status?: number;
          current?: Value | null;
          tombstone?: boolean;
        };
        tx.objectStore('outbox').put({
          ...pending,
          state,
          attempt: pending.attempt + 1,
          nextAttemptAt,
          error: error.message ?? '전송을 완료하지 못했어요.',
          errorCode: error.code,
          errorStatus: error.status,
        });
        if (state === 'conflict') {
          const entity: Entity | undefined = await idbRequest(
            tx
              .objectStore('entities')
              .get(
                keyOf(
                  workspaceId,
                  pending.operation.kind === 'ai.submit'
                    ? pending.operation.payload.sourceKind
                    : pending.operation.kind.split('.')[0],
                  pending.operation.entityId,
                ),
              ),
          );
          if (entity)
            tx.objectStore('conflicts').put({
              ...conflictCopies(entity, error, pending.operation.operationId),
              key: keyOf(workspaceId, pending.operation.operationId),
              workspaceId,
            });
        }
      });
    },
    nextWake: async () => {
      const pending = await listRecords<Pending>('outbox', workspaceId, 10000);
      const future = pending
        .filter((p) => p.state === 'queued' && p.nextAttemptAt > clock())
        .map((p) => p.nextAttemptAt);
      return future.length ? Math.min(...future) : undefined;
    },
    counts: async () => {
      const queue = await listRecords<Pending>('outbox', workspaceId, 10000);
      return {
        pending: queue.length,
        conflicts: queue.filter((p) => p.state === 'conflict').length,
      };
    },
  };
  return adapter;
}
