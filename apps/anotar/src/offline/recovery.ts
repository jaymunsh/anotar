import { removeEntity } from '../sync/summaries.ts';
import { getWorkspaceRuntime, resetRuntimeBinding, queueValue } from '../sync/runtime';
import { transport } from '../sync/transport';
import { transaction, idbRequest } from '../sync/db';
import {
  keyOf,
  readRecord,
  listRecords,
  readLocalBlob,
  type Entity,
  type Pending,
  type LocalBlob,
  type Value,
} from '../sync/repository';
import { pendingSignature } from './exportPending';
import { flushLocalEdits } from './update';
import { journalId, validateJournalDay } from '../../shared/journal.mjs';
export async function recoveryOverview() {
  const { workspaceId } = await getWorkspaceRuntime();
  const [server, identity, entities, outbox] = await Promise.all([
    transport.session(),
    readRecord<{ epoch: string; cursor: number }>('meta', workspaceId, 'sync'),
    listRecords<Entity>('entities', workspaceId, 100000),
    listRecords<Pending>('outbox', workspaceId, 100000),
  ]);
  return { workspaceId, server, identity, entities: entities.filter((e) => e.dirty), outbox };
}
export async function reconnectAfterReview({
  reviewed,
  selectedKeys = [],
}: {
  reviewed: boolean;
  selectedKeys?: string[];
}) {
  if (!reviewed) throw Error('기기 사본과 서버 자료를 확인한 뒤 선택해 주세요.');
  await flushLocalEdits();
  const { workspaceId, engine } = await getWorkspaceRuntime();
  const server = await transport.session();
  const exportReceipt = await readRecord<{ signature: string }>(
    'meta',
    workspaceId,
    'lastPendingExport',
  );
  const selected = await transaction(
    ['entities', 'outbox', 'conflicts', 'meta', 'leases', 'pins'],
    'readwrite',
    async (tx) => {
      const read = <T>(name: 'entities' | 'outbox' | 'conflicts') =>
        idbRequest<T[]>(tx.objectStore(name).index('workspace').getAll(workspaceId));
      const [entities, outbox, conflicts] = await Promise.all([
        read<Entity>('entities'),
        read<Pending>('outbox'),
        read<Record<string, unknown>>('conflicts'),
      ]);
      if (
        (entities.some((e) => e.dirty) || outbox.length || conflicts.some((c) => !c.resolvedAt)) &&
        exportReceipt?.signature !== pendingSignature(entities, outbox)
      )
        throw Error('최신 기기 사본을 먼저 내보내 주세요. 입력은 그대로 유지했어요.');
      if (server.workspaceId !== workspaceId && selectedKeys.length)
        throw Error(
          '다른 작업 공간에는 기기 변경을 자동 반영하지 않아요. 내보낸 사본을 확인해 주세요.',
        );
      if (server.workspaceId !== workspaceId) {
        const targetIdentity = await idbRequest(
          tx.objectStore('meta').get(keyOf(server.workspaceId, 'sync')),
        );
        const targetQueue = await idbRequest(
          tx.objectStore('outbox').index('workspace').getAll(server.workspaceId),
        );
        const targetConflicts = await idbRequest(
          tx.objectStore('conflicts').index('workspace').getAll(server.workspaceId),
        );
        const targetEntities = await idbRequest(
          tx.objectStore('entitySummaries').index('workspace').getAll(server.workspaceId),
        );
        if (
          targetIdentity?.epoch !== server.epoch &&
          (targetQueue.length ||
            targetConflicts.some((c) => !c.resolvedAt) ||
            targetEntities.some((e) => e.dirty))
        )
          throw Error(
            '돌아갈 작업 공간에도 미전송 사본이 있어요. 기존 서버 연결에서 그 사본을 먼저 내보내고 복구해 주세요. 어느 사본도 자동 전송하지 않았어요.',
          );
      }
      const chosen = entities.filter((e) => selectedKeys.includes(e.key) && e.dirty);
      tx.objectStore('meta').put({
        key: keyOf(workspaceId, 'recoveryArchive', crypto.randomUUID()),
        workspaceId,
        createdAt: new Date().toISOString(),
        entities: entities.filter(
          (e) =>
            e.dirty ||
            outbox.some((p) => p.operation.entityId === e.id) ||
            conflicts.some((c) => c.entityId === e.id),
        ),
        outbox,
        conflicts,
        previousIdentity: await idbRequest(tx.objectStore('meta').get(keyOf(workspaceId, 'sync'))),
      });
      const leases = tx.objectStore('leases'),
        leaseKey = keyOf(workspaceId, 'engine'),
        lease = await idbRequest(leases.get(leaseKey));
      leases.put({
        ...lease,
        key: leaseKey,
        workspaceId,
        owner: '',
        expiresAt: 0,
        fence: (lease?.fence ?? 0) + 1,
      });
      if (server.workspaceId === workspaceId) {
        for (const row of entities) removeEntity(tx, row.key);
        for (const row of outbox) tx.objectStore('outbox').delete(row.key);
        for (const row of conflicts) tx.objectStore('conflicts').delete(String(row.key));
        const pins = await idbRequest(
          tx.objectStore('pins').index('workspace').getAll(workspaceId),
        );
        for (const pin of pins)
          tx.objectStore('pins').put({
            ...pin,
            state: 'partial',
            missing: [{ id: 'app', error: '서버 복원 뒤 보관 자료를 다시 확인해 주세요.' }],
          });
      }
      tx.objectStore('meta').put({
        ...server,
        key: keyOf(server.workspaceId, 'sync'),
        workspaceId: server.workspaceId,
        cursor: 0,
      });
      tx.objectStore('meta').delete(keyOf(server.workspaceId, 'bootstrapped'));
      tx.objectStore('meta').delete(keyOf(server.workspaceId, 'recovery'));
      return chosen;
    },
  );
  engine.stop();
  const next = await resetRuntimeBinding(server);
  await next.engine.requestSync();
  const errors: string[] = [];
  // Allocate the complete graph before sending any create. Internal links must use the same IDs.
  const prepared: {
    entity: Entity;
    remote: Awaited<ReturnType<typeof transport.fetchEntity>>;
    id: string;
    value: Value;
    blobs: Omit<LocalBlob, 'key' | 'workspaceId'>[];
  }[] = [];
  const ids = new Map<string, string>();
  for (const entity of selected) {
    const remote = await transport.fetchEntity(entity.kind, entity.id);
    const id = entity.kind === 'journal'
      ? journalId(server.workspaceId,String(entity.current?.date))
      : remote.tombstone ? crypto.randomUUID() : entity.id;
    ids.set(entity.id, id);
    prepared.push({
      entity,
      remote,
      id,
      value: { ...entity.current!, id, version: remote.version ?? 1 },
      blobs: [],
    });
  }
  const external = new Map<string, boolean>();
  async function pageReference(id: unknown) {
    if (typeof id !== 'string' || !id) return null;
    if (ids.has(id)) return ids.get(id)!;
    if (!external.has(id)) external.set(id, !(await transport.fetchEntity('page', id)).tombstone);
    if (!external.get(id))
      throw Error(
        '연결한 페이지가 서버에 없어요. 관련 페이지도 선택하거나 원본 연결을 검토해 주세요.',
      );
    return id;
  }
  for (const item of prepared)
    try {
      const { entity, remote, blobs } = item;
      if (entity.kind === 'journal') item.value.day=validateJournalDay(item.value.day);
      if (!remote.item && entity.kind === 'capture') {
        const files = (entity.current?.files as Value[] | undefined) ?? [];
        for (const original of files) {
          const file = await readLocalBlob(workspaceId, String(original.id));
          if (!file)
            throw Error('첨부 바이트가 기기에 없어요. 내보낸 사본에서 원본을 확인해 주세요.');
          blobs.push({ ...file, id: crypto.randomUUID(), uploadId: crypto.randomUUID() });
        }
        item.value = {
          ...item.value,
          files: blobs.map((b) => ({ id: b.id, name: b.name, mime: b.mime, size: b.blob.size })),
          uploadIds: blobs.map((b) => b.uploadId),
          organizedAt: null,
          organizedPageId: null,
          aiRequest: null,
          latestAiJob: null,
        };
      }
      if (entity.kind === 'page') {
        const visit = async (blocks: any[]): Promise<any[]> =>
          Promise.all(
            blocks.map(async (block) => ({
              ...block,
              ...(remote.tombstone ? { id: crypto.randomUUID() } : {}),
              props: {
                ...block.props,
                ...(block.type === 'page'
                  ? { pageId: await pageReference(block.props?.pageId) }
                  : {}),
                ...(block.type === 'captureRef' && ids.has(block.props?.captureId)
                  ? { captureId: ids.get(block.props.captureId) }
                  : {}),
              },
              children: await visit(block.children ?? []),
            })),
          );
        item.value = {
          ...item.value,
          parentId: await pageReference(item.value.parentId),
          title: String(item.value.title).slice(0, 145) + (remote.tombstone ? ' (기기 사본)' : ''),
          document: {
            schemaVersion: 1,
            blocks: await visit((item.value.document as { blocks: any[] }).blocks),
          },
        };
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : '기기 사본을 다시 반영하지 못했어요.');
    }
  if (errors.length) throw Error(errors.join(' ') + ' 이전 사본은 복구 기록과 ZIP에 보존했어요.');
  // Empty new documents avoid cyclic create dependencies (parent links child, child has parent).
  // Once every create has a fixed UUID, newer full documents depend on the linked creates.
  const remaining = prepared.filter((p) => p.entity.kind === 'page' && !p.remote.item);
  const staged = new Set<string>();
  while (remaining.length) {
    const index = remaining.findIndex(
      (p) => !remaining.some((other) => other.id === p.value.parentId),
    );
    if (index < 0)
      throw Error('페이지 계층이 순환해요. 복구 기록에서 상위 페이지를 확인해 주세요.');
    const [item] = remaining.splice(index, 1);
    await queueValue(
      'page',
      item.id,
      {
        ...item.value,
        document: {
          schemaVersion: 1,
          blocks: [
            { id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [], children: [] },
          ],
        },
      },
      crypto.randomUUID(),
      [],
      [],
      true,
      0,
      null,
    );
    staged.add(item.id);
  }
  for (const item of prepared) {
    await queueValue(
      item.entity.kind,
      item.id,
      item.value,
      crypto.randomUUID(),
      item.blobs,
      [],
      true,
      0,
      staged.has(item.id) ? undefined : item.remote.item,
    );
  }
  await next.engine.requestSync();
  return { retained: selected.length };
}
