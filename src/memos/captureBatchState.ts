export const captureBatchStorageKey = 'leneu:capture-batch-pending';
export function hasPendingCaptureBatch() {
  try {
    return Boolean(sessionStorage.getItem(captureBatchStorageKey));
  } catch {
    return false;
  }
}
