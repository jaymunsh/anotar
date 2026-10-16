import { idbRequest, transaction } from './db.ts';
import type { Entity } from './repository.ts';
export type EntitySummary = Entity & {
  sortAt: string;
  hasDocument: boolean;
  organization: string;
  scope: string;
};
export function summaryOf(entity: Entity): EntitySummary {
  const { document, ...metadata } = entity.current ?? {};
  return {
    ...entity,
    base: null,
    remote: undefined,
    current: entity.current ? metadata : null,
    blobIds: [],
    hasDocument: Boolean(document),
    sortAt: String(entity.current?.updatedAt ?? entity.localSavedAt),
    organization: entity.current?.organizedAt ? 'organized' : 'inbox',
    scope: !entity.current ? 'inactive' : entity.current.aiRequest ? 'ai' : 'memo',
  };
}
export function putEntity(tx: IDBTransaction, entity: Entity) {
  tx.objectStore('entities').put(entity);
  tx.objectStore('entitySummaries').put(summaryOf(entity));
}
export function removeEntity(tx: IDBTransaction, key: string) {
  tx.objectStore('entities').delete(key);
  tx.objectStore('entitySummaries').delete(key);
}
// All list reads use metadata cursors. Page documents remain in the entity store.
export async function querySummaries(
  workspaceId: string,
  kind: Entity['kind'],
  {
    after,
    limit = 50,
    match = () => true,
  }: { after?: [string, string]; limit?: number; match?: (row: EntitySummary) => boolean } = {},
) {
  return transaction(
    ['entitySummaries'],
    'readonly',
    (tx) =>
      new Promise<{ rows: EntitySummary[]; nextCursor: string | null }>((resolve, reject) => {
        const lower = [workspaceId, kind, '', ''],
          upper = after ? [workspaceId, kind, ...after] : [workspaceId, kind, '\uffff', '\uffff'];
        const request = tx
            .objectStore('entitySummaries')
            .index('ordered')
            .openCursor(IDBKeyRange.bound(lower, upper, false, Boolean(after)), 'prev'),
          rows: EntitySummary[] = [];
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve({ rows, nextCursor: null });
            return;
          }
          const row = cursor.value as EntitySummary;
          if (row.current && match(row)) {
            if (rows.length >= Math.min(50, limit)) {
              const last = rows.at(-1)!;
              resolve({ rows, nextCursor: JSON.stringify([last.sortAt, last.id]) });
              return;
            }
            rows.push(row);
          }
          cursor.continue();
        };
      }),
  );
}
export async function allSummaries(workspaceId: string, kind: Entity['kind']) {
  const rows: EntitySummary[] = [];
  let after: [string, string] | undefined;
  do {
    const batch = await querySummaries(workspaceId, kind, { after });
    rows.push(...batch.rows);
    after = batch.nextCursor ? JSON.parse(batch.nextCursor) : undefined;
  } while (after);
  return rows;
}
export async function captureCounts(workspaceId: string, organization: string) {
  return transaction(['entitySummaries'], 'readonly', async (tx) => {
    const index = tx.objectStore('entitySummaries').index('captureScope');
    return {
      memo: await idbRequest(index.count([workspaceId, 'capture', organization, 'memo'])),
      ai: await idbRequest(index.count([workspaceId, 'capture', organization, 'ai'])),
    };
  });
}
