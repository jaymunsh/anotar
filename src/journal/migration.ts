import {
  journalId,
  normalizeJournalDay,
  parseLegacyJournal,
  type JournalDay,
} from '../../shared/journal.mjs';
import { operationForEntity } from '../sync/workspaceRepository';
import { idbRequest, transaction } from '../sync/db';
import { putEntity } from '../sync/summaries';
import {
  keyOf,
  announceLocalChanges,
  readRecord,
  listRecords,
  type Entity,
  type Pending,
  type Value,
} from '../sync/repository';
import type { Identity } from '../sync/engine';

const sourceKey = 'anotar:journal:v1';
const ownerKey = keyOf('@device', 'legacyJournalSource', sourceKey);
export async function claimJournalLegacyOwner(workspaceId: string) {
  if (localStorage.getItem(sourceKey) === null) return;
  await transaction(['meta'], 'readwrite', async (tx) => {
    const meta = tx.objectStore('meta');
    if (!(await idbRequest(meta.get(ownerKey))))
      meta.put({
        key: ownerKey,
        workspaceId: '@device',
        sourceKey,
        sourceWorkspaceId: workspaceId,
        claimedAt: new Date().toISOString(),
      });
  });
}
export type JournalMigrationCollision = {
  key: string;
  workspaceId: string;
  date: string;
  legacyDay: JournalDay;
  existing: Value;
  existingRevision: number;
  resolvedAt?: string;
  choice?: 'existing' | 'legacy';
};
export async function migrateJournal(
  workspaceId: string,
  deviceId: string,
  raw = localStorage.getItem('anotar:journal:v1'),
) {
  if (!raw) return { imported: 0, conflicts: 0 };
  const days = parseLegacyJournal(raw);
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  const result = await transaction(
    ['entities', 'outbox', 'meta', 'conflicts'],
    'readwrite',
    async (tx) => {
      const meta = tx.objectStore('meta'),
        archiveKey = keyOf(workspaceId, 'legacy', 'anotar:journal:v1', digest);
      const owner = await idbRequest(meta.get(ownerKey));
      if (owner && owner.sourceWorkspaceId !== workspaceId)
        return { imported: 0, conflicts: 0, foreign: true };
      if (!owner)
        meta.put({
          key: ownerKey,
          workspaceId: '@device',
          sourceKey,
          sourceWorkspaceId: workspaceId,
          claimedAt: new Date().toISOString(),
        });
      if (await idbRequest(meta.get(archiveKey))) return { imported: 0, conflicts: 0 };
      const identity: Identity = await idbRequest(meta.get(keyOf(workspaceId, 'sync')));
      const previous: Entity[] = [],
        previousPending: Pending[] = [],
        previousConflicts: Record<string, unknown>[] = [],
        now = new Date().toISOString();
      let imported = 0,
        conflicts = 0,
        localConflicts = 0;
      for (const [date, day] of Object.entries(days)) {
        const id = journalId(workspaceId, date),
          key = keyOf(workspaceId, 'journal', id);
        const old: Entity | undefined = await idbRequest(tx.objectStore('entities').get(key));
        if (JSON.stringify(old?.current?.day) === JSON.stringify(day)) continue;
        if (old) previous.push(old);
        if (old?.dirty && old.current) {
          const heads: Pending[] = await idbRequest(
            tx.objectStore('outbox').index('workspace').getAll(workspaceId),
          );
          previousPending.push(...heads.filter((head) => head.operation.entityId === id));
          // This is a collision between two local copies, not a server conflict.
          // Keep existing edits/operations and require an explicit source choice.
          meta.put({
            key: keyOf(workspaceId, 'legacyJournalCollision', digest, date),
            workspaceId,
            date,
            legacyDay: day,
            existing: old.current,
            existingRevision: old.localRevision,
            archiveKey,
          });
          localConflicts++;
          continue;
        }
        const entity: Entity = {
          key,
          workspaceId,
          kind: 'journal',
          id,
          base: old?.base ?? null,
          current: {
            id,
            date,
            day,
            version: old?.current?.version ?? 1,
            createdAt: old?.current?.createdAt ?? now,
            updatedAt: now,
            clientCreatedAt: old?.current?.clientCreatedAt ?? now,
          },
          localRevision: (old?.localRevision ?? 0) + 1,
          dirty: true,
          localSavedAt: now,
          lastRemoteReadSeq: old?.lastRemoteReadSeq ?? 0,
          blobIds: [],
          remote: old?.remote,
        };
        putEntity(tx, entity);
        const operation = operationForEntity(entity, identity, deviceId);
        const collision = Boolean(old?.current);
        const pending: Pending = {
          key: keyOf(workspaceId, operation.operationId),
          workspaceId,
          operation,
          localRevision: entity.localRevision,
          dependencies: [],
          state: collision ? 'conflict' : 'queued',
          attempt: 0,
          nextAttemptAt: 0,
          ...(collision
            ? {
                error: '기존 날짜와 이전 기기 일지의 내용이 달라요. 양쪽 사본을 확인해 주세요.',
                errorCode: 'legacy_journal_collision',
              }
            : {}),
        };
        tx.objectStore('outbox').add(pending);
        if (collision) {
          // Preserve earlier local work and its frozen operations in the same
          // archive. One active conflict owns this date until explicit review.
          const heads: Pending[] = await idbRequest(
            tx.objectStore('outbox').index('workspace').getAll(workspaceId),
          );
          for (const head of heads)
            if (head.operation.entityId === id && head.key !== pending.key) {
              previousPending.push(head);
              tx.objectStore('outbox').delete(head.key);
            }
          const copies: Record<string, unknown>[] = await idbRequest(
            tx.objectStore('conflicts').index('workspace').getAll(workspaceId),
          );
          for (const copy of copies)
            if (copy.entityId === id) {
              previousConflicts.push(copy);
              tx.objectStore('conflicts').delete(String(copy.key));
            }
          tx.objectStore('conflicts').put({
            key: pending.key,
            workspaceId,
            operationId: operation.operationId,
            entityKind: 'journal',
            entityId: id,
            base: old?.base,
            local: entity.current,
            server: old?.current,
            tombstone: false,
          });
          conflicts++;
        } else imported++;
      }
      // Exact source JSON and overwritten cache copies remain exportable. A
      // single IDB commit archives them together with all dates and the queue.
      meta.put({
        key: archiveKey,
        workspaceId,
        raw,
        previous,
        previousPending,
        previousConflicts,
        imported,
        conflicts,
        localConflicts,
        confirmedAt: now,
      });
      return { imported, conflicts, ...(localConflicts ? { localConflicts } : {}) };
    },
  );
  announceLocalChanges();
  return result;
}

export async function listJournalMigrationCollisions(workspaceId: string) {
  return (await listRecords<JournalMigrationCollision>('meta', workspaceId, 100000)).filter(
    (row) => row.key.includes('"legacyJournalCollision"') && !row.resolvedAt,
  );
}
export async function resolveJournalMigration(key: string, choice: 'existing' | 'legacy') {
  const { getWorkspaceRuntime, queueValue } = await import('../sync/runtime');
  const { workspaceId } = await getWorkspaceRuntime();
  const collision = await transaction(['meta'], 'readonly', (tx) =>
    idbRequest<JournalMigrationCollision | undefined>(tx.objectStore('meta').get(key)),
  );
  if (!collision || collision.workspaceId !== workspaceId || collision.resolvedAt)
    throw Error('이미 처리했거나 다른 작업 공간의 일지예요.');
  const id = journalId(workspaceId, collision.date);
  const existing = await readRecord<Entity>('entities', workspaceId, 'journal', id);
  if (!existing?.current)
    throw Error('현재 기기 일지를 먼저 다시 불러와 주세요. 이전 원본은 보존했어요.');
  if (JSON.stringify(existing.current.day) !== JSON.stringify(collision.existing.day)) {
    await transaction(['meta'], 'readwrite', (tx) => {
      tx.objectStore('meta').put({
        ...collision,
        existing: existing.current,
        existingRevision: existing.localRevision,
      });
    });
    throw Error('현재 기기 일지가 바뀌었어요. 최신 사본을 확인한 뒤 다시 선택해 주세요.');
  }
  if (choice === 'legacy')
    await queueValue(
      'journal',
      id,
      { ...existing.current, day: normalizeJournalDay(collision.legacyDay, collision.date) },
      crypto.randomUUID(),
      [],
      [],
      true,
      0,
      existing.base,
      existing.localRevision,
    );
  await transaction(['meta'], 'readwrite', (tx) => {
    tx.objectStore('meta').put({ ...collision, resolvedAt: new Date().toISOString(), choice });
  });
  announceLocalChanges();
}
