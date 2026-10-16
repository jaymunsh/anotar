import { summaryOf } from './summaries.ts';
export const STORES = [
  'entities',
  'entitySummaries',
  'outbox',
  'blobs',
  'conflicts',
  'pins',
  'meta',
  'leases',
] as const;
export type StoreName = (typeof STORES)[number];
let database: Promise<IDBDatabase> | undefined;
export function openWorkspaceDb(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('leneu-offline-v1', 2);
    let rejected = false;
    request.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!request.result.objectStoreNames.contains(name)) {
          const store = request.result.createObjectStore(name, { keyPath: 'key' });
          store.createIndex('workspace', 'workspaceId');
        }
      }
      const summaries = request.transaction!.objectStore('entitySummaries');
      summaries.createIndex('ordered', ['workspaceId', 'kind', 'sortAt', 'id']);
      summaries.createIndex('captureScope', ['workspaceId', 'kind', 'organization', 'scope']);
      const entities = request.transaction!.objectStore('entities');
      entities.createIndex('kind', ['workspaceId', 'kind']);
      const cursor = entities.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (row) {
          summaries.put(summaryOf(row.value));
          row.continue();
        }
      };
    };
    request.onblocked = () => {
      rejected = true;
      reject(
        new Error('저장소 업데이트를 위해 다른 leneu 창을 닫아 주세요. 기존 자료는 유지됩니다.'),
      );
    };
    request.onerror = () =>
      reject(
        new Error(
          request.error?.name === 'VersionError'
            ? '이 기기의 저장소는 더 새 버전이에요. 앱을 업데이트해 주세요. 자료는 그대로 남아 있어요.'
            : '기기 저장소를 열지 못했어요. 브라우저 저장 공간을 확인해 주세요.',
        ),
      );
    request.onsuccess = () => {
      if (rejected) {
        request.result.close();
        return;
      }
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        database = undefined;
      };
      resolve(db);
    };
  }).catch((error) => {
    database = undefined;
    if ((error as DOMException)?.name === 'QuotaExceededError')
      throw new Error(
        '기기 저장 공간이 부족해요. 입력은 그대로 유지했어요. 보관 페이지를 해제하거나 서버에 연결해 주세요.',
      );
    throw error;
  });
  return database;
}
export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function transaction<T>(
  names: StoreName[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openWorkspaceDb(),
    tx = db.transaction(
      mode === 'readwrite' && names.includes('entities')
        ? [...new Set([...names, 'entitySummaries','pins','blobs','meta'])]
        : names,
      mode,
    );
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('기기 저장을 완료하지 못했어요.'));
    tx.onerror = () => {};
  });
  try {
    const result = await work(tx);
    await done;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* already aborted */
    }
    await done.catch(() => {});
    if ((error as DOMException)?.name === 'QuotaExceededError')
      throw new Error(
        '기기 저장 공간이 부족해요. 입력은 그대로 유지했어요. 보관 페이지를 해제하거나 서버에 연결해 주세요.',
      );
    throw error;
  }
}
