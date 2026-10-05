type StoredAttachment = { blob: Blob; name: string; type: string; lastModified: number };
let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('leneu-draft-files-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('attachments');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('첨부 임시저장소가 다른 창에서 사용 중이에요.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        database = undefined;
      };
      resolve(db);
    };
  }).catch((error) => {
    database = undefined;
    throw error;
  });
  return database;
}

export async function readAttachmentDraft(id: string) {
  const db = await openDatabase();
  const records = await new Promise<StoredAttachment[]>((resolve, reject) => {
    const transaction = db.transaction('attachments', 'readonly');
    const request = transaction.objectStore('attachments').get(id);
    transaction.oncomplete = () => resolve(request.result ?? []);
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
  if (!Array.isArray(records) || records.length > 8)
    throw new Error('첨부 초안이 올바르지 않아요.');
  return records.map((item) => {
    if (!(item.blob instanceof Blob) || typeof item.name !== 'string')
      throw new Error('첨부 초안이 올바르지 않아요.');
    return new File([item.blob], item.name, { type: item.type, lastModified: item.lastModified });
  });
}

export async function writeAttachmentDraft(id: string, files: File[]) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('attachments', 'readwrite');
    const store = transaction.objectStore('attachments');
    if (files.length)
      store.put(
        files.map((file) => ({
          blob: file,
          name: file.name,
          type: file.type,
          lastModified: file.lastModified,
        })),
        id,
      );
    else store.delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}
