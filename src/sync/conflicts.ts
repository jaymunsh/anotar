import { putEntity } from './summaries.ts';
import type { SyncEntity } from '../../shared/sync.ts';
import type { Entity, Value } from './repository.ts';
export type ConflictRecord = {
  operationId: string;
  entityKind: Entity['kind'];
  entityId: string;
  base: Value | null;
  local: Value | null;
  server: Value | null;
  tombstone: boolean;
  resolvedAt?: string;
  choice?: 'server' | 'local' | 'fork';
};
export function conflictCopies(
  entity: Entity,
  error: { current?: Value | null; tombstone?: boolean },
  operationId: string,
): ConflictRecord {
  return {
    operationId,
    entityKind: entity.kind,
    entityId: entity.id,
    base: structuredClone(entity.base),
    local: structuredClone(entity.current),
    server: structuredClone(error.current ?? entity.remote?.item ?? null),
    tombstone: error.tombstone ?? Boolean(entity.remote?.tombstone),
  };
}
export function shouldApplyRemote(entity: Entity | undefined, incoming: SyncEntity) {
  return (
    !entity ||
    (incoming.readSeq >= entity.lastRemoteReadSeq &&
      (incoming.tombstone || Number(incoming.version) >= Number(entity.base?.version ?? 0)))
  );
}

export async function resolveConflict({
  id,
  choice,
  expectedRemoteVersion,
}: {
  id: string;
  choice: 'server' | 'local' | 'fork';
  expectedRemoteVersion: number | null;
}) {
  const [
    { getWorkspaceRuntime },
    { transport },
    { transaction, idbRequest },
    repo,
    { operationForEntity },
  ] = await Promise.all([
    import('./runtime'),
    import('./transport'),
    import('./db'),
    import('./repository'),
    import('./workspaceRepository'),
  ]);
  const { workspaceId, deviceId, engine } = await getWorkspaceRuntime();
  const conflict = await repo.readRecord<ConflictRecord>('conflicts', workspaceId, id);
  if (!conflict || conflict.resolvedAt) throw Error('이미 처리한 변경이에요.');
  const identity = await repo.readRecord<{ workspaceId: string; epoch: string; cursor: number }>(
    'meta',
    workspaceId,
    'sync',
  );
  const session = await transport.session();
  if (!identity || session.workspaceId !== workspaceId || session.epoch !== identity.epoch)
    throw Error('서버가 바뀌었어요. 복구 안내를 먼저 확인해 주세요.');
  const remote = await transport.fetchEntity(conflict.entityKind, conflict.entityId);
  if ((remote.tombstone ? null : remote.version) !== expectedRemoteVersion) {
    await repo.writeRecord('conflicts', workspaceId, [id], {
      ...conflict,
      server: remote.item,
      tombstone: remote.tombstone,
    });
    throw Error('서버 내용이 다시 바뀌었어요. 최신 내용을 확인한 뒤 선택해 주세요.');
  }
  if (choice === 'local' && remote.tombstone)
    throw Error('삭제된 자료는 새 페이지로 보관해 주세요.');
  if (choice === 'fork' && conflict.entityKind !== 'page')
    throw Error('페이지에서만 새 페이지로 보관할 수 있어요.');
  const result = await transaction(['entities', 'conflicts', 'outbox'], 'readwrite', async (tx) => {
    const entities = tx.objectStore('entities'),
      key = repo.keyOf(workspaceId, conflict.entityKind, conflict.entityId),
      entity: Entity = await idbRequest(entities.get(key));
    if (!entity?.current) throw Error('기기에 저장한 변경을 찾지 못했어요.');
    const active = await idbRequest(tx.objectStore('conflicts').get(repo.keyOf(workspaceId, id)));
    if (active?.resolvedAt) throw Error('다른 창에서 이미 처리했어요.');
    tx.objectStore('conflicts').put({
      ...active,
      local: entity.current,
      server: remote.item,
      tombstone: remote.tombstone,
      resolvedAt: new Date().toISOString(),
      choice,
    });
    const heads: import('./repository').Pending[] = await idbRequest(
      tx.objectStore('outbox').index('workspace').getAll(workspaceId),
    );
    tx.objectStore('conflicts').put({
      ...active,
      local: entity.current,
      server: remote.item,
      tombstone: remote.tombstone,
      resolvedAt: new Date().toISOString(),
      choice,
      pendingOperations: heads.filter((p) => p.operation.entityId === entity.id),
    });
    const removed = new Set(
      heads
        .filter(
          (p) => p.operation.entityId === entity.id && /\.(create|update)$/.test(p.operation.kind),
        )
        .map((p) => p.operation.operationId),
    );
    for (const head of heads)
      if (removed.has(head.operation.operationId)) tx.objectStore('outbox').delete(head.key);
    let changed = true;
    const affected = new Set<string>();
    while (changed) {
      changed = false;
      for (const head of heads)
        if (
          !removed.has(head.operation.operationId) &&
          !affected.has(head.operation.operationId) &&
          head.dependencies.some((d) => removed.has(d) || affected.has(d))
        ) {
          affected.add(head.operation.operationId);
          changed = true;
        }
    }
    for (const head of heads)
      if (affected.has(head.operation.operationId)) {
        tx.objectStore('outbox').put({
          ...head,
          state: 'conflict',
          errorCode: 'source_review',
          error: '앞선 원본의 충돌을 처리했어요. 요청 당시 내용과 대상을 다시 확인해 주세요.',
        });
        if (/\.(create|update)$/.test(head.operation.kind)) {
          const other: Entity | undefined = await idbRequest(
            entities.get(
              repo.keyOf(workspaceId, head.operation.kind.split('.')[0], head.operation.entityId),
            ),
          );
          if (other)
            tx.objectStore('conflicts').put({
              ...conflictCopies(other, {}, head.operation.operationId),
              key: head.key,
              workspaceId,
            });
        }
      }
    let next: Entity = {
      ...entity,
      base: remote.item,
      current: remote.item,
      remote: undefined,
      dirty: false,
      lastRemoteReadSeq: remote.readSeq,
    };
    if (choice === 'local')
      next = {
        ...next,
        current: entity.current,
        dirty: true,
        localRevision: entity.localRevision + 1,
      };
    putEntity(tx, next);
    if (choice === 'fork') {
      const newId = crypto.randomUUID(),
        now = new Date().toISOString();
      const clone = (blocks: any[]): any[] =>
        blocks.map((block) => ({
          ...structuredClone(block),
          id: crypto.randomUUID(),
          children: clone(block.children ?? []),
        }));
      const source = entity.current as unknown as { document: { schemaVersion: 1; blocks: any[] } };
      next = {
        ...entity,
        key: repo.keyOf(workspaceId, 'page', newId),
        id: newId,
        base: null,
        remote: undefined,
        localRevision: 1,
        dirty: true,
        lastRemoteReadSeq: 0,
        current: {
          ...entity.current,
          id: newId,
          title: String(entity.current.title).slice(0, 150) + ' (기기 사본)',
          parentId: null,
          version: 1,
          createdAt: now,
          clientCreatedAt: now,
          updatedAt: now,
          document: { schemaVersion: 1, blocks: clone(source.document.blocks) },
        },
      };
      putEntity(tx, next);
    }
    if (next.dirty) {
      const operation = operationForEntity(next, identity, deviceId);
      tx.objectStore('outbox').add({
        key: repo.keyOf(workspaceId, operation.operationId),
        workspaceId,
        operation,
        localRevision: next.localRevision,
        dependencies: [],
        state: 'queued',
        attempt: 0,
        nextAttemptAt: 0,
      });
    }
    return { pageId: next.id, item: next.current };
  });
  repo.announceLocalChanges();
  void engine.requestSync();
  return result;
}
