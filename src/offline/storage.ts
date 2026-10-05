import { listRecords, type LocalBlob } from '../sync/repository';
export const OFFLINE_BUDGET = 200 * 1024 * 1024;
export async function storageStatus(workspaceId: string) {
  const [files, estimate, persisted] = await Promise.all([
    listRecords<LocalBlob>('blobs', workspaceId, 100000),
    navigator.storage?.estimate?.().catch(() => ({})) ?? {},
    navigator.storage?.persisted?.().catch(() => false) ?? false,
  ]);
  const unique = new Map(files.map((file) => [file.hash, file.blob.size]));
  return { bytes: [...unique.values()].reduce((sum, size) => sum + size, 0), estimate, persisted };
}
export async function requestPersistentStorage() {
  return navigator.storage?.persist?.().catch(() => false) ?? false;
}
export async function checkDownloadSpace(
  workspaceId: string,
  bytes: number,
  budget = OFFLINE_BUDGET,
) {
  const status = await storageStatus(workspaceId);
  const estimate = status.estimate as StorageEstimate;
  if (
    status.bytes + bytes > budget ||
    (estimate.quota && estimate.quota - (estimate.usage ?? 0) < bytes)
  )
    throw Error('기기 보관 공간이 부족해요. 다른 보관 페이지를 해제하고 다시 시도해 주세요.');
}
