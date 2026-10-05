import type { SyncEntityKind, SyncOperation } from '../../shared/sync';
import { getWorkspaceRuntime } from './runtime';
import { idbRequest, transaction } from './db';
import { announceLocalChanges, keyOf, type Entity, type Pending, type Value } from './repository';
import { operationForEntity, pageDependencies } from './workspaceRepository';
import { subscribeLocalChanges, listRecords } from './repository';
import { useEffect, useState } from 'react';
import { readRecord } from './repository';

export type QueuedWorkflow = { queued: true; operationId: string };
export async function workflowResult(operationId: string) {
  const { workspaceId, engine } = await getWorkspaceRuntime();
  if (navigator.onLine) await engine.requestSync();
  return (
    await readRecord<{ result: { workflow?: { item: Value; blockIds?: string[] } } }>(
      'meta',
      workspaceId,
      'ack',
      operationId,
    )
  )?.result.workflow;
}
const isWrite = (pending: Pending) => /\.(create|update)$/.test(pending.operation.kind);
export async function queueWorkflow(
  kind: 'capture.organize' | 'ai.submit',
  sourceKind: SyncEntityKind,
  sourceId: string,
  requestId: string,
  input: Value,
): Promise<QueuedWorkflow> {
  const { workspaceId, deviceId, engine } = await getWorkspaceRuntime();
  await transaction(['entities', 'outbox', 'meta'], 'readwrite', async (tx) => {
    const queue = tx.objectStore('outbox'),
      key = keyOf(workspaceId, requestId);
    if (
      (await idbRequest(queue.get(key))) ||
      (await idbRequest(tx.objectStore('meta').get(keyOf(workspaceId, 'ack', requestId))))
    )
      return;
    const identity = await idbRequest(tx.objectStore('meta').get(keyOf(workspaceId, 'sync')));
    const heads: Pending[] = await idbRequest(queue.index('workspace').getAll(workspaceId));
    const dependencies: string[] = [];
    async function bind(entityKind: SyncEntityKind, id: string) {
      const entity: Entity | undefined = await idbRequest(
        tx.objectStore('entities').get(keyOf(workspaceId, entityKind, id)),
      );
      if (!entity?.current) throw Error('먼저 원본을 이 기기에서 열어 주세요.');
      if (
        heads.some((p) => p.operation.entityId === id && ['failed', 'conflict'].includes(p.state))
      )
        throw Error('원본의 변경 내용을 먼저 확인해 주세요.');
      const writes = heads
        .filter((p) => p.operation.entityId === id && isWrite(p))
        .sort((a, b) => b.localRevision - a.localRevision);
      let last = writes[0];
      if (entity.dirty && (!last || last.localRevision < entity.localRevision)) {
        const operation = operationForEntity(
          last && !entity.base ? { ...entity, base: { ...entity.current, version: 1 } } : entity,
          identity,
          deviceId,
        );
        if (last) {
          operation.baseVersion = 1;
          operation.baseOperationId = last.operation.operationId;
        }
        const next: Pending = {
          key: keyOf(workspaceId, operation.operationId),
          workspaceId,
          operation,
          localRevision: entity.localRevision,
          dependencies: [
            ...(last ? [last.operation.operationId] : []),
            ...pageDependencies(entity, heads),
          ],
          state: 'queued',
          attempt: 0,
          nextAttemptAt: 0,
        };
        queue.add(next);
        heads.push(next);
        last = next;
      }
      if (last) dependencies.push(last.operation.operationId);
      return { entity, operationId: last?.operation.operationId };
    }
    const source = await bind(sourceKind, sourceId);
    const target = input.target ? (structuredClone(input.target) as Value) : undefined;
    if (target?.pageId) {
      const binding = await bind('page', String(target.pageId));
      if (
        target.expectedVersion !== undefined &&
        target.expectedVersion !== binding.entity.current!.version
      )
        throw Error('선택한 페이지가 바뀌었어요. 다시 선택해 주세요.');
      target.expectedVersion = binding.entity.current!.version;
      if (binding.operationId) target.operationId = binding.operationId;
    } else if (target?.parentId) await bind('page', String(target.parentId));
    const value = source.entity.current!;
    const sourceSnapshot =
      sourceKind === 'capture'
        ? { text: value.text, url: value.url }
        : { title: value.title, document: value.document };
    const operation = {
      protocolVersion: 1,
      workspaceId,
      epoch: identity.epoch,
      deviceId,
      operationId: requestId,
      entityId: sourceId,
      kind,
      baseVersion: Number(source.entity.base?.version ?? 1),
      payload: {
        ...structuredClone(input),
        requestId,
        sourceSnapshot,
        ...(target ? { target } : {}),
        ...(source.operationId ? { sourceOperationId: source.operationId } : {}),
        ...(kind === 'capture.organize'
          ? { localAssetIds: ((value.files as Value[]) ?? []).map((f) => f.id) }
          : { sourceKind }),
      },
    } as unknown as SyncOperation;
    if (new Blob([JSON.stringify(operation)]).size > 1100 * 1024)
      throw Error('요청 내용이 너무 커요. 선택 범위를 줄여 주세요.');
    queue.add({
      key,
      workspaceId,
      operation,
      localRevision: source.entity.localRevision,
      dependencies: [...new Set(dependencies)],
      state: 'queued',
      attempt: 0,
      nextAttemptAt: 0,
    });
  });
  announceLocalChanges();
  void engine.requestSync();
  return { queued: true, operationId: requestId };
}
export async function cancelQueuedWorkflow(operationId: string) {
  const { workspaceId } = await getWorkspaceRuntime();
  await transaction(['outbox'], 'readwrite', async (tx) => {
    const store = tx.objectStore('outbox'),
      key = keyOf(workspaceId, operationId),
      pending: Pending | undefined = await idbRequest(store.get(key));
    if (!pending) return;
    if (pending.state !== 'queued' || pending.attempt > 0)
      throw Error('서버 접수 여부를 확인한 뒤 취소할 수 있어요. 지금 동기화를 눌러 주세요.');
    store.delete(key);
  });
  announceLocalChanges();
}
export async function dismissRejectedWorkflow(operationId: string) {
  const { workspaceId, engine } = await getWorkspaceRuntime();
  await transaction(['outbox', 'meta', 'conflicts'], 'readwrite', async (tx) => {
    const store = tx.objectStore('outbox'),
      key = keyOf(workspaceId, operationId),
      pending: Pending | undefined = await idbRequest(store.get(key));
    if (!pending) return;
    if (
      !['conflict', 'failed'].includes(pending.state) ||
      !pending.errorCode ||
      pending.errorCode === 'payload_mismatch'
    )
      throw Error('접수 여부를 먼저 확인해 주세요. 기기 요청 사본은 유지했어요.');
    tx.objectStore('meta').put({
      key: keyOf(workspaceId, 'rejectedWorkflow', operationId),
      workspaceId,
      pending,
      reviewedAt: new Date().toISOString(),
    });
    store.delete(key);
    const conflict = await idbRequest(tx.objectStore('conflicts').get(key));
    if (conflict)
      tx.objectStore('conflicts').put({
        ...conflict,
        resolvedAt: new Date().toISOString(),
        choice: 'cancel-request',
      });
  });
  announceLocalChanges();
  void engine.requestSync();
}
export function useQueuedWorkflows(sourceId?: string) {
  const [items, setItems] = useState<Pending[]>([]);
  useEffect(() => {
    let active = true;
    const load = () =>
      void getWorkspaceRuntime()
        .then(async ({ workspaceId }) => {
          const rows = await listRecords<Pending>('outbox', workspaceId, 10000);
          if (active)
            setItems(
              rows.filter(
                (p) =>
                  (p.operation.kind === 'ai.submit' || p.operation.kind === 'capture.organize') &&
                  (!sourceId || p.operation.entityId === sourceId),
              ),
            );
        })
        .catch(() => {});
    load();
    const unsubscribe = subscribeLocalChanges(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [sourceId]);
  return items;
}

// Only a definitive validation rejection may be replaced. Unknown outcomes keep the original UUID.
export async function replaceRejectedWrite(operationId: string) {
  const { workspaceId, deviceId, engine } = await getWorkspaceRuntime();
  await transaction(['entities', 'outbox', 'meta', 'conflicts'], 'readwrite', async (tx) => {
    const outbox = tx.objectStore('outbox');
    const pending: Pending | undefined = await idbRequest(
      outbox.get(keyOf(workspaceId, operationId)),
    );
    if (
      !pending ||
      pending.state !== 'failed' ||
      ![404, 413, 422].includes(pending.errorStatus ?? 0) ||
      pending.errorCode === 'payload_mismatch' ||
      !isWrite(pending)
    )
      throw Error('서버 접수 여부를 먼저 확인해 주세요. 기존 요청 사본은 유지했어요.');
    const kind = pending.operation.kind.split('.')[0] as SyncEntityKind;
    const entity: Entity | undefined = await idbRequest(
      tx.objectStore('entities').get(keyOf(workspaceId, kind, pending.operation.entityId)),
    );
    if (!entity?.current || entity.localRevision <= pending.localRevision)
      throw Error('원문을 먼저 수정한 뒤 고친 내용으로 다시 전송해 주세요.');
    tx.objectStore('meta').put({
      key: keyOf(workspaceId, 'rejectedWrite', operationId),
      workspaceId,
      pending,
      reviewedAt: new Date().toISOString(),
    });
    outbox.delete(pending.key);
    const heads: Pending[] = await idbRequest(outbox.index('workspace').getAll(workspaceId));
    const affected = new Set([operationId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const head of heads)
        if (
          !affected.has(head.operation.operationId) &&
          head.dependencies.some((id) => affected.has(id))
        ) {
          affected.add(head.operation.operationId);
          changed = true;
        }
    }
    for (const head of heads)
      if (affected.has(head.operation.operationId)) {
        outbox.put({
          ...head,
          state: 'conflict',
          errorCode: 'source_review',
          error: '원본을 고쳐 다시 전송했어요. 요청 당시 내용과 대상을 다시 확인해 주세요.',
        });
        if (isWrite(head)) {
          const other: Entity | undefined = await idbRequest(
            tx
              .objectStore('entities')
              .get(keyOf(workspaceId, head.operation.kind.split('.')[0], head.operation.entityId)),
          );
          if (other)
            tx.objectStore('conflicts').put({
              key: head.key,
              workspaceId,
              operationId: head.operation.operationId,
              entityKind: other.kind,
              entityId: other.id,
              base: other.base,
              local: other.current,
              server: other.remote?.item ?? other.base,
              tombstone: false,
            });
        }
      }
    const identity = await idbRequest(tx.objectStore('meta').get(keyOf(workspaceId, 'sync')));
    const operation = operationForEntity(entity, identity, deviceId);
    outbox.add({
      key: keyOf(workspaceId, operation.operationId),
      workspaceId,
      operation,
      localRevision: entity.localRevision,
      dependencies: pageDependencies(
        entity,
        heads.filter((h) => !affected.has(h.operation.operationId)),
      ),
      state: 'queued',
      attempt: 0,
      nextAttemptAt: 0,
    });
  });
  announceLocalChanges();
  void engine.requestSync();
}
