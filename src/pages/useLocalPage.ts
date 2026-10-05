import { useEffect, useState } from 'react';
import { getWorkspaceRuntime, queueValue, enqueueCurrentPage } from '../sync/runtime';
import {
  readLocalEntity,
  subscribeLocalChanges,
  listRecords,
  type Entity,
} from '../sync/repository';
import type { ConflictRecord } from '../sync/conflicts';
import type { PageRecord } from './types';
export function useLocalPage(pageId: string) {
  const [record, setRecord] = useState<Entity>(),
    [conflict, setConflict] = useState<ConflictRecord>();
  useEffect(() => {
    let active = true;
    let sequence = 0;
    async function refresh() {
      const current = ++sequence;
      try {
        const { workspaceId } = await getWorkspaceRuntime();
        const [entity, conflicts] = await Promise.all([
          readLocalEntity({ workspaceId, kind: 'page', id: pageId }),
          listRecords<ConflictRecord>('conflicts', workspaceId, 10000),
        ]);
        if (active && current === sequence) {
          setRecord(entity);
          setConflict(conflicts.find((c) => c.entityId === pageId && !c.resolvedAt));
        }
      } catch {}
    }
    void refresh();
    const off = subscribeLocalChanges(() => void refresh());
    return () => {
      active = false;
      off();
    };
  }, [pageId]);
  return { record, conflict };
}
export async function persistLocalPage(
  pageId: string,
  changes: Pick<PageRecord, 'title' | 'icon' | 'document'>,
  base: PageRecord,
  expectedLocalRevision?: number,
) {
  const { workspaceId } = await getWorkspaceRuntime(),
    entity = await readLocalEntity({ workspaceId, kind: 'page', id: pageId });
  if (!entity?.current) throw Error('먼저 페이지를 열어 주세요.');
  const value = {
    ...entity.current,
    ...changes,
    title: changes.title.trim() || '제목 없음',
    updatedAt: new Date().toISOString(),
  };
  if (new TextEncoder().encode(JSON.stringify(value.document)).length > 1024 * 1024)
    throw Error('페이지 본문은 1MB까지 저장할 수 있어요.');
  return (await queueValue(
    'page',
    pageId,
    value,
    crypto.randomUUID(),
    [],
    [],
    false,
    Date.now() + 500,
    entity.dirty || !entity.base ? entity.base : base,
    expectedLocalRevision,
  )) as PageRecord;
}
export async function enqueueLocalPage(pageId: string) {
  await enqueueCurrentPage(pageId);
}
