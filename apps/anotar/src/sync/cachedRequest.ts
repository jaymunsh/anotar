// 온라인 전용: 서버에서 바로 읽는다. 예전 IndexedDB 캐시(verifyRemoteAccess) 경로는 제거했다.
export async function cachedRequest<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error('자료를 불러오지 못했어요.');
  return (await response.json()) as T;
}
