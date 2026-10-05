import { verifyRemoteAccess, fetchVerifiedEntity, cacheVerifiedRecord } from '../sync/remoteGuard';
import { attachmentReferences } from './references';
import { putEntity } from '../sync/summaries.ts';
import type { SyncEntity } from '../../shared/sync';
import { transaction, idbRequest } from '../sync/db';
import {
  keyOf,
  readRecord,
  readLocalBlob,
  writeRecord,
  applyRemoteEntity,
  announceLocalChanges,
  type Entity,
} from '../sync/repository';
import { checkDownloadSpace } from './storage';
export type PinResult = {
  pageId: string;
  title: string;
  state: 'ready' | 'partial' | 'updating';
  version: number;
  assetIds: string[];
  missing: { id: string; error: string }[];
  appVersion: string;
  savedAt: string;
  successfulVersion?: number;
  successfulEntity?: SyncEntity;
  latestVersion?: number;
};
type Dependencies = {
  workspaceId: string;
  shell: () => Promise<{ ready: boolean; appVersion: string }>;
  fetchEntity: (id: string) => Promise<SyncEntity>;
  fetchAsset: (id: string) => Promise<{ blob: Blob; name: string; mime: string }>;
  budget?: number;
  identity?: { workspaceId: string; epoch: string };
};
async function defaults(): Promise<Dependencies> {
  const [{ getWorkspaceRuntime }, { prepareOfflineShell }] = await Promise.all([
    import('../sync/runtime'),
    import('./update'),
  ]);
  const { workspaceId } = await getWorkspaceRuntime();
  const identity = await readRecord<{ workspaceId: string; epoch: string }>(
    'meta',
    workspaceId,
    'sync',
  );
  return {
    workspaceId,
    identity,
    shell: prepareOfflineShell,
    fetchEntity: (id) => fetchVerifiedEntity(workspaceId, 'page', id),
    fetchAsset: async (id) => {
      await verifyRemoteAccess(workspaceId);
      const [infoResponse, response] = await Promise.all([
        fetch(`/api/assets/${id}/info`),
        fetch(`/api/assets/${id}`),
      ]);
      if (!infoResponse.ok || !response.ok) throw Error('첨부를 내려받지 못했어요.');
      const { item } = await infoResponse.json();
      const blob = await response.blob();
      if (blob.size !== item.size) throw Error('첨부 크기를 확인하지 못했어요.');
      await verifyRemoteAccess(workspaceId);
      return { blob, name: item.name, mime: item.mime };
    },
  };
}
export function directAssetIds(document: unknown): string[] {
  const ids = new Set<string>();
  function visit(blocks: unknown) {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      if (!block || ['captureRef', 'page', 'tableOfContents'].includes(block.type)) continue;
      if (
        ['asset', 'map', 'itinerary'].includes(block.type) &&
        typeof block.props?.assetId === 'string' &&
        block.props.assetId
      )
        ids.add(block.props.assetId);
      visit(block.children);
    }
  }
  visit((document as { blocks?: unknown })?.blocks);
  return [...ids];
}
export async function pinPage(
  { pageId, assetSelection }: { pageId: string; assetSelection?: string[] },
  supplied?: Dependencies,
): Promise<PinResult> {
  const deps = supplied ?? (await defaults()),
    w = deps.workspaceId;
  const write = async (
    store: 'pins' | 'blobs',
    parts: string[],
    value: Record<string, unknown>,
  ) => {
    if (deps.identity) {
      await verifyRemoteAccess(w);
      await cacheVerifiedRecord(deps.identity, store, parts, value);
    } else await writeRecord(store, w, parts, value);
  };
  const previous = await readRecord<PinResult>('pins', w, pageId);
  const canonical = await deps.fetchEntity(pageId);
  if (!canonical.item?.document || canonical.tombstone)
    throw Error('보관할 페이지를 찾지 못했어요.');
  const all = directAssetIds(canonical.item.document),
    assetIds = assetSelection ? all.filter((id) => assetSelection.includes(id)) : all;
  const result: PinResult = {
    pageId,
    title: String(canonical.item.title || '제목 없음'),
    state: 'updating',
    version: canonical.version!,
    assetIds,
    missing: all
      .filter((id) => !assetIds.includes(id))
      .map((id) => ({
        id,
        error: '선택하지 않은 첨부예요. 완전 보관하려면 모든 첨부를 선택해 주세요.',
      })),
    appVersion: '',
    savedAt: new Date().toISOString(),
    successfulEntity: previous?.successfulEntity,
    successfulVersion: previous?.successfulVersion,
  };
  await write('pins', [pageId], result);
  try {
    for (const id of assetIds)
      try {
        if (await readLocalBlob(w, id)) continue;
        const file = await deps.fetchAsset(id);
        await checkDownloadSpace(w, file.blob.size, deps.budget);
        const hash = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', await file.blob.arrayBuffer())),
          (b) => b.toString(16).padStart(2, '0'),
        ).join('');
        await write('blobs', [id], { ...file, id, hash });
      } catch (error) {
        result.missing.push({
          id,
          error: error instanceof Error ? error.message : '첨부 보관 실패',
        });
      }
    const shell = await deps.shell();
    result.appVersion = shell.appVersion;
    if (!shell.ready)
      result.missing.push({
        id: 'app',
        error: '앱 실행 파일 준비가 필요해요. 연결 후 다시 보관해 주세요.',
      });
    result.state = result.missing.length ? 'partial' : 'ready';
    // On a failed refresh, keep the last usable document and map instead of exposing an incomplete new version.
    if (!previous?.successfulVersion || result.state === 'ready')
      await applyRemoteEntity(w, canonical);
    if (result.state === 'ready') {
      result.successfulVersion = result.version;
      result.successfulEntity = canonical;
    } else if (previous?.successfulVersion) {
      result.version = previous.successfulVersion;
      result.successfulVersion = previous.successfulVersion;
      result.assetIds = [...new Set([...previous.assetIds, ...result.assetIds])];
    }
    await write('pins', [pageId], result);
    return result;
  } catch (error) {
    await write('pins', [pageId], {
      ...previous,
      ...result,
      state: 'partial',
      missing: [
        ...result.missing,
        { id: 'app', error: error instanceof Error ? error.message : '보관 실패' },
      ],
    });
    throw error;
  }
}
export async function getOfflineAvailability(
  pageId: string,
  supplied?: Pick<Dependencies, 'workspaceId'>,
) {
  const w = (supplied ?? (await defaults())).workspaceId;
  return (await readRecord<PinResult>('pins', w, pageId))?.state ?? 'missing';
}
export async function unpinPage(pageId: string, supplied?: Pick<Dependencies, 'workspaceId'>) {
  const w = (supplied ?? (await defaults())).workspaceId;
  await transaction(
    ['pins', 'entities', 'blobs', 'conflicts', 'outbox', 'meta'],
    'readwrite',
    async (tx) => {
      const pins = tx.objectStore('pins'),
        key = keyOf(w, pageId),
        pin: PinResult | undefined = await idbRequest(pins.get(key));
      pins.delete(key);
      if (!pin) return;
      const entities: Entity[] = await idbRequest(
        tx.objectStore('entities').index('workspace').getAll(w),
      );
      const conflicts = await idbRequest(tx.objectStore('conflicts').index('workspace').getAll(w));
      const queue = await idbRequest(tx.objectStore('outbox').index('workspace').getAll(w));
      const own = entities.find((e) => e.kind === 'page' && e.id === pageId);
      const protectedPage =
        own?.dirty ||
        conflicts.some((c) => c.entityId === pageId) ||
        queue.some((p) => p.operation.entityId === pageId);
      if (own && !protectedPage) {
        const current = { ...own.current },
          base = { ...own.base };
        delete current.document;
        delete base.document;
        putEntity(tx, { ...own, current, base, blobIds: [] });
      }
      const archives = await idbRequest(tx.objectStore('meta').index('workspace').getAll(w));
      const remaining = await idbRequest(pins.index('workspace').getAll(w));
      const keep = attachmentReferences(
        archives,
        remaining,
        entities.filter((e) => e !== own || protectedPage),
        conflicts,
        queue,
      ).ids;
      for (const item of remaining) for (const id of item.assetIds) keep.add(id);
      for (const id of pin.assetIds)
        if (!keep.has(id)) tx.objectStore('blobs').delete(keyOf(w, id));
    },
  );
  announceLocalChanges();
}
