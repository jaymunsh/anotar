import { verifyRemoteAccess, cacheVerifiedRecord, fetchVerifiedEntity } from './remoteGuard';
import { putEntity, allSummaries, querySummaries, captureCounts } from './summaries.ts';
import type { SyncEntityKind, SyncOperation } from '../../shared/sync.ts';
import { createSyncEngine, type EngineSnapshot } from './engine.ts';
import {
  workspaceRepository,
  operationForEntity,
  pageDependencies,
} from './workspaceRepository.ts';
import { transport } from './transport.ts';
import { idbRequest, transaction } from './db.ts';
import {
  keyOf,
  readRecord,
  writeRecord,
  readLocalEntity,
  readLocalBlob,
  listRecords,
  subscribeLocalChanges,
  announceLocalChanges,
  migrateLegacyDrafts,
  type Entity,
  type LocalBlob,
  type Pending,
  type Value,
} from './repository.ts';
import { publishRecordChange } from '../trash/events';
let runtime: Promise<Runtime> | undefined;
let runtimeGeneration = 0;
const runtimeDisposers: (() => void)[] = [];
type Runtime = {
  workspaceId: string;
  deviceId: string;
  engine: ReturnType<typeof createSyncEngine>;
  repository: ReturnType<typeof workspaceRepository>;
};
const listeners = new Set<() => void>();
let snapshot: EngineSnapshot = {
  state: 'idle',
  pending: 0,
  conflicts: 0,
  error: '',
  lastSync: null,
};
export const getSyncSnapshot = () => snapshot;
export function reportRecovery() {
  snapshot = {
    ...snapshot,
    state: 'recovery',
    error: '서버가 바뀌었어요. 기기에 저장한 자료를 확인해 주세요.',
  };
  notify();
}
export function subscribeSync(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function notify() {
  listeners.forEach((fn) => fn());
}
const assetURLs = new Map<string, string>();
export async function localAssetUrl(id: string) {
  const { workspaceId } = await getWorkspaceRuntime();
  const blob = await readLocalBlob(workspaceId, id);
  if (!blob) return `/api/assets/${id}`;
  let url = assetURLs.get(id);
  if (!url) {
    url = URL.createObjectURL(blob.blob);
    assetURLs.set(id, url);
  }
  return url;
}
export function getWorkspaceRuntime(): Promise<Runtime> {
  runtime ??= (async () => {
    const generation = runtimeGeneration;
    const storedBinding = await readRecord<{ boundWorkspaceId?: string; deviceId: string }>(
      'meta',
      '@device',
      'binding',
    );
    let binding = storedBinding?.boundWorkspaceId
      ? { workspaceId: storedBinding.boundWorkspaceId, deviceId: storedBinding.deviceId }
      : undefined;
    const fresh = !binding;
    if (!binding) {
      const session = await transport.session();
      binding = { workspaceId: session.workspaceId, deviceId: crypto.randomUUID() };
      await writeRecord('meta', binding.workspaceId, ['sync'], { ...session, cursor: 0 });
      await writeRecord('meta', '@device', ['binding'], {
        boundWorkspaceId: binding.workspaceId,
        deviceId: binding.deviceId,
      });
    }
    const { workspaceId, deviceId } = binding;
    const {claimJournalLegacyOwner}=await import('../journal/migration');
    await claimJournalLegacyOwner(workspaceId);
    const repository = workspaceRepository(workspaceId, deviceId);
    repository.prepareUploads = async (pending, network) => {
      if (
        pending.operation.kind !== 'capture.create' ||
        !pending.operation.payload.uploadIds.length
      )
        return;
      if (pending.attempt > 0) {
        try {
          return await network.applyOperation(pending.operation);
        } catch (error) {
          if ((error as { code?: string }).code !== 'upload_missing') throw error;
        }
      }
      const blobs = await listRecords<LocalBlob>('blobs', workspaceId, 10000);
      for (const uploadId of pending.operation.payload.uploadIds) {
        const file = blobs.find((blob) => blob.uploadId === uploadId);
        if (!file) throw Error('기기에 저장한 첨부를 찾지 못했어요. 원문은 유지했어요.');
        await network.upload!(file.blob, {
          uploadId,
          operationId: pending.operation.operationId,
          hash: file.hash,
          mime: file.mime,
          name: file.name,
        });
      }
    };
    const engine = createSyncEngine({ repository, transport });
    runtimeDisposers.push(
      engine.subscribe(() => {
        if (generation !== runtimeGeneration) return;
        snapshot = engine.getSnapshot();
        notify();
      }),
    );
    let refresh: ReturnType<typeof setTimeout> | undefined;
    runtimeDisposers.push(
      subscribeLocalChanges(() => {
        if (generation !== runtimeGeneration) return;
        clearTimeout(refresh);
        refresh = setTimeout(() => {
          publishRecordChange('local-sync');
          void repository.counts().then((counts) => {
            snapshot = { ...snapshot, ...counts };
            notify();
          });
        }, 100);
      }),
    );
    runtimeDisposers.push(() => clearTimeout(refresh));
    await migrateLegacyDrafts({ workspaceId });
    // A reload can land after the 250ms local commit but before the 750ms queue timer.
    await transaction(['entities', 'outbox', 'meta'], 'readwrite', async (tx) => {
      const summaries = await idbRequest(
        tx.objectStore('entitySummaries').index('workspace').getAll(workspaceId),
      );
      const entities: Entity[] = await Promise.all(
        summaries
          .filter((e: { dirty: boolean }) => e.dirty)
          .map((e: { key: string }) => idbRequest(tx.objectStore('entities').get(e.key))),
      );
      const outbox = tx.objectStore('outbox'),
        heads: Pending[] = await idbRequest(outbox.index('workspace').getAll(workspaceId));
      const identity = await idbRequest(tx.objectStore('meta').get(keyOf(workspaceId, 'sync')));
      for (const entity of entities)
        if (
          entity.dirty &&
          entity.current &&
          !heads.some(
            (p) =>
              p.operation.entityId === entity.id && /\.(create|update)$/.test(p.operation.kind),
          )
        ) {
          const operation = operationForEntity(entity, identity, deviceId);
          const pending: Pending = {
            key: keyOf(workspaceId, operation.operationId),
            workspaceId,
            operation,
            localRevision: entity.localRevision,
            dependencies: [],
            state: 'queued',
            attempt: 0,
            nextAttemptAt: entity.stableAt ?? 0,
          };
          heads.push(pending);
        }
      for (const pending of heads) {
        const entity = entities.find((e) => e.id === pending.operation.entityId);
        if (!(await idbRequest(outbox.get(pending.key))))
          outbox.add({ ...pending, dependencies: entity ? pageDependencies(entity, heads) : [] });
      }
    });
    void import('../offline/update.ts')
      .then((module) => module.prepareOfflineShell())
      .catch(() => {});
    engine.start();
    if (fresh) await engine.requestSync();
    return { workspaceId, deviceId, engine, repository };
  })().catch((error) => {
    runtime = undefined;
    snapshot = {
      ...snapshot,
      state: 'offline',
      error: error instanceof Error ? error.message : '기기 저장소를 준비하지 못했어요.',
    };
    notify();
    throw error;
  });
  return runtime;
}
export async function resetRuntimeBinding(session: import('../../shared/sync').SyncSession) {
  const old = await getWorkspaceRuntime();
  const {claimJournalLegacyOwner}=await import('../journal/migration');
  await claimJournalLegacyOwner(old.workspaceId);
  old.engine.stop();
  runtimeGeneration++;
  runtimeDisposers.splice(0).forEach((dispose) => dispose());
  assetURLs.forEach((url) => URL.revokeObjectURL(url));
  assetURLs.clear();
  await writeRecord('meta', '@device', ['binding'], {
    boundWorkspaceId: session.workspaceId,
    deviceId: old.deviceId,
  });
  runtime = undefined;
  snapshot = { state: 'idle', pending: 0, conflicts: 0, error: '', lastSync: null };
  notify();
  return getWorkspaceRuntime();
}
export async function enqueueCurrentPage(id: string) {
  const { workspaceId, deviceId, engine } = await getWorkspaceRuntime();
  await transaction(['entities', 'outbox', 'meta'], 'readwrite', async (tx) => {
    const entity: Entity | undefined = await idbRequest(
      tx.objectStore('entities').get(keyOf(workspaceId, 'page', id)),
    );
    if (!entity?.dirty || !entity.current) return;
    const outbox = tx.objectStore('outbox'),
      heads: Pending[] = await idbRequest(outbox.index('workspace').getAll(workspaceId));
    if (
      heads.some(
        (head) => head.operation.entityId === id && /\.(create|update)$/.test(head.operation.kind),
      )
    )
      return;
    const identity = await idbRequest(tx.objectStore('meta').get(keyOf(workspaceId, 'sync'))),
      operation = operationForEntity(entity, identity, deviceId);
    outbox.add({
      key: keyOf(workspaceId, operation.operationId),
      workspaceId,
      operation,
      localRevision: entity.localRevision,
      dependencies: pageDependencies(entity, heads),
      state: 'queued',
      attempt: 0,
      nextAttemptAt: entity.stableAt ?? 0,
    });
  });
  announceLocalChanges();
  void engine.requestSync();
}
export async function requestWorkspaceSync() {
  const runtime = await getWorkspaceRuntime();
  await transaction(['outbox'], 'readwrite', async (tx) => {
    const store = tx.objectStore('outbox'),
      items: Pending[] = await idbRequest(store.index('workspace').getAll(runtime.workspaceId));
    for (const item of items) if (item.state === 'queued') store.put({ ...item, nextAttemptAt: 0 });
  });
  return runtime.engine.requestSync();
}
export async function listLocalEntities(kind: SyncEntityKind, limit = 50) {
  const { workspaceId } = await getWorkspaceRuntime();
  if (limit <= 50) return (await querySummaries(workspaceId, kind, { limit })).rows;
  return (await allSummaries(workspaceId, kind)).slice(0, limit);
}
export async function queueValue(
  kind: SyncEntityKind,
  id: string,
  value: Value,
  operationId: string = crypto.randomUUID(),
  blobs: Omit<LocalBlob, 'key' | 'workspaceId'>[] = [],
  dependencies: string[] = [],
  enqueue = true,
  stableAt = 0,
  baseOverride?: Value | null,
  expectedLocalRevision?: number,
) {
  const { workspaceId, deviceId, engine } = await getWorkspaceRuntime();
  const result = await transaction(
    ['entities', 'outbox', 'blobs', 'meta'],
    'readwrite',
    async (tx) => {
      const outbox = tx.objectStore('outbox'),
        prior: Pending | undefined = await idbRequest(outbox.get(keyOf(workspaceId, operationId)));
      if (prior) {
        return (
          await idbRequest(
            tx.objectStore('entities').get(keyOf(workspaceId, kind, prior.operation.entityId)),
          )
        ).current as Value;
      }
      const ack = await idbRequest(
        tx.objectStore('meta').get(keyOf(workspaceId, 'ack', operationId)),
      );
      if (ack) return ack.result.item as Value;
      const entities = tx.objectStore('entities'),
        key = keyOf(workspaceId, kind, id),
        previous: Entity | undefined = await idbRequest(entities.get(key));
      if (
        expectedLocalRevision !== undefined &&
        (previous?.localRevision ?? 0) !== expectedLocalRevision
      ) {
        tx.objectStore('meta').put({
          key: keyOf(workspaceId, 'localEditConflict', crypto.randomUUID()),
          workspaceId,
          entityId: id,
          createdAt: new Date().toISOString(),
          base: baseOverride ?? previous?.base,
          local: value,
          other: previous?.current,
          expectedLocalRevision,
          actualLocalRevision: previous?.localRevision,
        });
        return { localConflict: true } as Value;
      }
      const localRevision = (previous?.localRevision ?? 0) + 1,
        entity: Entity = {
          key,
          workspaceId,
          kind,
          id,
          base: baseOverride === undefined ? (previous?.base ?? null) : baseOverride,
          current: value,
          remote: previous?.remote,
          localRevision,
          dirty: true,
          stableAt,
          localSavedAt: new Date().toISOString(),
          lastRemoteReadSeq: previous?.lastRemoteReadSeq ?? 0,
          blobIds: blobs.length ? blobs.map((b) => b.id) : (previous?.blobIds ?? []),
        };
      putEntity(tx, entity);
      for (const blob of blobs)
        tx.objectStore('blobs').put({ ...blob, key: keyOf(workspaceId, blob.id), workspaceId });
      const heads: Pending[] = await idbRequest(outbox.index('workspace').getAll(workspaceId));
      if (
        enqueue &&
        !heads.some(
          (head) =>
            head.operation.entityId === id && /\.(create|update)$/.test(head.operation.kind),
        )
      ) {
        const state = await idbRequest(tx.objectStore('meta').get(keyOf(workspaceId, 'sync')));
        const operation = {
          ...operationForEntity(entity, state, deviceId),
          operationId,
        } as SyncOperation;
        outbox.add({
          key: keyOf(workspaceId, operationId),
          workspaceId,
          operation,
          localRevision,
          dependencies: [...new Set([...dependencies, ...pageDependencies(entity, heads)])],
          state: 'queued',
          attempt: 0,
          nextAttemptAt: stableAt,
        });
      }
      return { ...value, localRevision };
    },
  );
  announceLocalChanges();
  if (result.localConflict)
    throw new Error(
      '같은 기기의 다른 창에서 수정했어요. 이 창의 원문과 다른 창의 사본을 보존했어요. 원문을 내려받고 다시 열어 확인해 주세요.',
    );
  if (enqueue) void engine.requestSync();
  return result;
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
async function filesWithUrls(item: Value) {
  if (!Array.isArray(item.files)) return item;
  return {
    ...item,
    files: await Promise.all(
      item.files.map(async (file: Value) => ({
        ...file,
        localUrl: await localAssetUrl(String(file.id)),
      })),
    ),
  };
}
export async function workspaceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (path === '/api/workspace/pages' && (!init.method || init.method === 'GET')) {
    const { workspaceId } = await getWorkspaceRuntime();
    try {
      const verified = await verifyRemoteAccess(workspaceId);
      const r = await fetch(path, init);
      if (!r.ok) throw Error('탐색 정보를 불러오지 못했어요.');
      const data = await r.json();
      await verifyRemoteAccess(workspaceId);
      const previous = await readRecord<{ snapshot: unknown }>('meta', workspaceId, 'navigation');
      if (JSON.stringify(previous?.snapshot) !== JSON.stringify(data))
        await cacheVerifiedRecord(verified, 'meta', ['navigation'], { snapshot: data });
      return response(data);
    } catch {
      const cached = await readRecord<{ snapshot: unknown }>('meta', workspaceId, 'navigation');
      return response(cached?.snapshot ?? { favorites: [], recentVisited: [], favoriteIds: [] });
    }
  }
  const assetMatch = path.match(/^\/api\/assets\/([a-f0-9-]+)\/info$/);
  if (assetMatch && (!init.method || init.method === 'GET')) {
    const { workspaceId } = await getWorkspaceRuntime();
    const blob = await readLocalBlob(workspaceId, assetMatch[1]);
    if (blob)
      return response({
        item: { id: blob.id, name: blob.name, mime: blob.mime, size: blob.blob.size },
      });
    await verifyRemoteAccess(workspaceId);
    return fetch(path, init);
  }
  const url = new URL(path, location.origin),
    match = url.pathname.match(/^\/api\/(captures|tasks|pages)(?:\/([a-f0-9-]+))?$/);
  if (!match) return fetch(path, init);
  const kind: SyncEntityKind =
      match[1] === 'captures' ? 'capture' : match[1] === 'pages' ? 'page' : 'task',
    id = match[2],
    method = init.method ?? 'GET';
  try {
    const { workspaceId, engine } = await getWorkspaceRuntime();
    if (method === 'GET') {
      if (navigator.onLine && getSyncSnapshot().state === 'ready') await engine.requestSync();
      if (id) {
        let entity = await readLocalEntity({ workspaceId, kind, id });
        if (kind === 'page' && navigator.onLine && !entity?.dirty) {
          try {
            const canonical = await fetchVerifiedEntity(workspaceId, kind, id);
            const { applyRemoteEntity } = await import('./repository');
            await applyRemoteEntity(workspaceId, canonical);
            entity = await readLocalEntity({ workspaceId, kind, id });
            if (canonical.tombstone && !entity?.dirty)
              return response({ error: '페이지를 찾을 수 없습니다.' }, 404);
          } catch {
            /* Cached body remains readable when the connection fails. */
          }
        }
        if (entity?.current && (kind !== 'page' || entity.current.document))
          return response({
            item:
              kind === 'capture'
                ? await filesWithUrls(entity.current)
                : { ...entity.current, localRevision: entity.localRevision },
          });
        if (kind === 'page' && (!navigator.onLine || getSyncSnapshot().state === 'offline'))
          return response(
            { error: '이 기기에 보관하지 않은 페이지예요. 연결 후 열거나 오프라인 보관해 주세요.' },
            503,
          );
        const canonical = await fetchVerifiedEntity(workspaceId, kind, id);
        const { applyRemoteEntity } = await import('./repository.ts');
        await applyRemoteEntity(workspaceId, canonical);
        return response({ item: canonical.item }, canonical.tombstone ? 404 : 200);
      }
      if (kind === 'capture') {
        const organization = url.searchParams.get('organization') ?? 'inbox',
          scope = url.searchParams.get('scope') ?? 'memo',
          filter = url.searchParams.get('kind') ?? 'all',
          query = (url.searchParams.get('q') ?? '').toLocaleLowerCase();
        let after: [string, string] | undefined;
        try {
          const parsed = JSON.parse(url.searchParams.get('cursor') ?? 'null');
          if (
            Array.isArray(parsed) &&
            parsed.length === 2 &&
            parsed.every((v) => typeof v === 'string')
          )
            after = parsed as [string, string];
        } catch {}
        const batch = await querySummaries(workspaceId, 'capture', {
          after,
          match: (row) => {
            const item = row.current!;
            return (
              row.organization === organization &&
              (scope === 'all' || row.scope === scope) &&
              (filter === 'all' || item.kind === filter) &&
              (!query ||
                [
                  item.text,
                  item.url,
                  ...((item.files as Value[] | undefined) ?? []).map((f) => f.name),
                ]
                  .join(' ')
                  .toLocaleLowerCase()
                  .includes(query))
            );
          },
        });
        return response({
          items: await Promise.all(
            batch.rows.map((row) =>
              filesWithUrls({ ...row.current, syncState: row.dirty ? 'pending' : 'synced' }),
            ),
          ),
          counts: await captureCounts(workspaceId, organization),
          nextCursor: batch.nextCursor,
        });
      }
      const rows = await allSummaries(workspaceId, kind),
        items: Value[] = rows.map((e) => ({
          ...e.current,
          syncState: e.dirty ? 'pending' : 'synced',
        }));
      if (kind === 'page') return response({ items, stagingPageId: null });
      const stage = url.searchParams.get('stage'),
        status = url.searchParams.get('status') ?? 'open',
        counts = {
          open: items.filter((t) => t.stage !== 'done').length,
          done: items.filter((t) => t.stage === 'done').length,
        },
        stageCounts = {
          todo: items.filter((t) => t.stage === 'todo').length,
          doing: items.filter((t) => t.stage === 'doing').length,
          done: counts.done,
        };
      const filtered = items
        .filter((t) => (stage ? t.stage === stage : (status === 'done') === (t.stage === 'done')))
        .sort((a, b) => {
          if (status === 'done' || stage === 'done')
            return String(b.completedAt ?? '').localeCompare(String(a.completedAt ?? ''));
          const today = new Date().toISOString().slice(0, 10),
            aDue = a.dueDate && String(a.dueDate) <= today ? String(a.dueDate) : '9999',
            bDue = b.dueDate && String(b.dueDate) <= today ? String(b.dueDate) : '9999';
          return (
            String(aDue).localeCompare(String(bDue)) || Number(a.position) - Number(b.position)
          );
        });
      const state = await readRecord<{ cursor: number }>('meta', workspaceId, 'sync'),
        revision =
          String(state?.cursor ?? 0) + ':' + rows.reduce((sum, e) => sum + e.localRevision, 0);
      let previous: { offset: number; revision: string } | null = null;
      try {
        previous = JSON.parse(url.searchParams.get('cursor') ?? 'null');
      } catch {}
      const reset = Boolean(previous && previous.revision !== revision),
        offset = previous && !reset ? Math.max(0, previous.offset) : 0,
        limit = Math.min(50, Number(url.searchParams.get('limit') ?? 50));
      return response({
        items: filtered.slice(offset, offset + limit),
        counts,
        stageCounts,
        reset,
        nextCursor:
          filtered.length > offset + limit
            ? JSON.stringify({ offset: offset + limit, revision })
            : null,
      });
    }
    if (method === 'POST' && kind === 'capture') {
      const form = init.body;
      if (!(form instanceof FormData))
        return response({ error: '메모 저장 형식이 올바르지 않아요.' }, 422);
      const selection = form.has('aiRequest') ? JSON.parse(String(form.get('aiRequest'))) : null;
      const submitAi = async (item: Value) => {
        if (!selection) return;
        const { queueWorkflow } = await import('./workflows');
        const digest = new Uint8Array(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ai:' + requestId)),
        );
        digest[6] = (digest[6] & 15) | 64;
        digest[8] = (digest[8] & 63) | 128;
        const hex = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join(
          '',
        );
        const id = [
          hex.slice(0, 8),
          hex.slice(8, 12),
          hex.slice(12, 16),
          hex.slice(16, 20),
          hex.slice(20),
        ].join('-');
        await queueWorkflow('ai.submit', 'capture', String(item.id), id, { request: selection });
      };
      const requestId = String(form.get('requestId') || crypto.randomUUID()),
        old = await readRecord<Pending>('outbox', workspaceId, requestId),
        ack = await readRecord<{ result: { item: Value } }>('meta', workspaceId, 'ack', requestId);
      if (old) {
        const item = (await readLocalEntity({ workspaceId, kind, id: old.operation.entityId }))!
          .current!;
        await submitAi(item);
        return response({ item, local: true });
      }
      if (ack) {
        await submitAi(ack.result.item);
        return response({ item: ack.result.item, local: !!selection });
      }
      const files = form.getAll('files').filter((file): file is File => file instanceof File);
      if (
        files.length > 8 ||
        files.some((f) => f.size > 25 * 1024 * 1024) ||
        files.reduce((sum, f) => sum + f.size, 0) > 100 * 1024 * 1024
      )
        return response({ error: '첨부는 8개·파일당 25MB·전체 100MB까지 저장할 수 있어요.' }, 413);
      const blobs = await Promise.all(
        files.map(async (file) => ({
          id: crypto.randomUUID(),
          uploadId: crypto.randomUUID(),
          blob: file,
          hash: Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
            (b) => b.toString(16).padStart(2, '0'),
          ).join(''),
          name: file.name,
          mime: file.type || 'application/octet-stream',
        })),
      );
      const createdAt = new Date().toISOString(),
        entityId = crypto.randomUUID(),
        value = {
          id: entityId,
          kind: String(form.get('kind')),
          text: String(form.get('text') ?? '').trim(),
          url: String(form.get('url') ?? '') || null,
          createdAt,
          clientCreatedAt: createdAt,
          updatedAt: createdAt,
          version: 1,
          organizedAt: null,
          organizedPageId: null,
          organizedOperationId: null,
          aiRequest: selection
            ? (await import('../../shared/aiRequests')).storeRequestSnapshot(selection, {
                content: String(form.get('text') ?? '').trim(),
                url: String(form.get('url') ?? ''),
              })
            : null,
          latestAiJob: null,
          isSample: false,
          uploadIds: blobs.map((b) => b.uploadId),
          files: blobs.map((b) => ({
            id: b.id,
            key: b.id,
            name: b.name,
            mime: b.mime,
            size: b.blob.size,
          })),
        };
      const item = await queueValue(kind, entityId, value, requestId, blobs);
      await submitAi(item);
      return response({ item, local: true }, 201);
    }
    const body = JSON.parse(String(init.body ?? '{}')) as Value;
    if (method === 'POST' && kind === 'page') {
      const createdAt = new Date().toISOString(),
        entityId = crypto.randomUUID();
      const parentId = typeof body.parentId === 'string' ? body.parentId : null;
      const dependencies = (await listRecords<Pending>('outbox', workspaceId, 10000))
        .filter((p) => p.operation.entityId === parentId && p.operation.kind === 'page.create')
        .map((p) => p.operation.operationId);
      const value = {
        id: entityId,
        title: typeof body.title === 'string' ? body.title.trim() || '제목 없음' : '제목 없음',
        icon: body.icon ?? '',
        parentId,
        position: Date.now(),
        version: 1,
        createdAt,
        clientCreatedAt: createdAt,
        updatedAt: createdAt,
        document: body.document ?? {
          schemaVersion: 1,
          blocks: [
            { id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [], children: [] },
          ],
        },
      };
      return response(
        {
          item: await queueValue('page', entityId, value, crypto.randomUUID(), [], dependencies),
          local: true,
        },
        201,
      );
    }
    if (method === 'POST' && kind === 'task') {
      const createdAt = new Date().toISOString(),
        entityId = crypto.randomUUID(),
        value = {
          id: entityId,
          title: body.title,
          dueDate: body.dueDate ?? null,
          pageId: body.pageId ?? null,
          status: 'open',
          stage: 'todo',
          position: Date.now(),
          createdAt,
          clientCreatedAt: createdAt,
          updatedAt: createdAt,
          completedAt: null,
          version: 1,
        };
      return response(
        {
          item: await queueValue(
            kind,
            entityId,
            value,
            String(body.requestId ?? crypto.randomUUID()),
          ),
          local: true,
        },
        201,
      );
    }
    if (id && ['PUT', 'PATCH'].includes(method)) {
      const entity = await readLocalEntity({ workspaceId, kind, id });
      if (!entity?.current) return response({ error: '자료를 불러온 뒤 수정해 주세요.' }, 404);
      if (body.expectedVersion !== entity.current.version)
        return response({ error: '다른 곳에서 먼저 수정했어요.', current: entity.current }, 409);
      const value: Value = { ...entity.current, ...body, updatedAt: new Date().toISOString() };
      delete value.expectedVersion;
      if (kind === 'task') {
        value.status = value.stage === 'done' ? 'done' : 'open';
        value.completedAt =
          value.stage === 'done' ? (value.completedAt ?? new Date().toISOString()) : null;
      }
      return response({ item: await queueValue(kind, id, value), local: true });
    }
    return fetch(path, init);
  } catch (error) {
    return response(
      {
        error:
          error instanceof Error
            ? error.message
            : '기기에 저장하지 못했어요. 입력은 그대로 유지했어요.',
      },
      503,
    );
  }
}
