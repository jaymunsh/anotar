import { getWorkspaceRuntime } from './runtime';
import { verifyRemoteAccess, cacheVerifiedRecord } from './remoteGuard';
import { readRecord } from './repository';
export async function cachedRequest<T>(path: string, signal?: AbortSignal): Promise<T> {
  const { workspaceId } = await getWorkspaceRuntime();
  try {
    const identity = await verifyRemoteAccess(workspaceId);
    const response = await fetch(path, { signal });
    if (!response.ok) throw Error('자료를 불러오지 못했어요.');
    const snapshot = await response.json();
    await verifyRemoteAccess(workspaceId);
    const cached = await readRecord<{ snapshot: T }>('meta', workspaceId, 'http', path);
    if (JSON.stringify(cached?.snapshot) !== JSON.stringify(snapshot))
      await cacheVerifiedRecord(identity, 'meta', ['http', path], { snapshot });
    return snapshot;
  } catch (error) {
    if (signal?.aborted) throw error;
    const cached = await readRecord<{ snapshot: T }>('meta', workspaceId, 'http', path);
    if (cached) return cached.snapshot;
    throw error;
  }
}
