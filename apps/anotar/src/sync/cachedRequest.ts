// 온라인 전용: 서버에서 바로 읽는다. 예전 IndexedDB 캐시(verifyRemoteAccess) 경로는 제거했다.
export async function cachedRequest<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) {
    // 서버가 보낸 안내({ error })가 있으면 그대로 보여준다. 없으면 일반 문구를 쓴다.
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const message = typeof body?.error === 'string' && body.error.trim() ? body.error : '';
    throw new Error(message || '자료를 불러오지 못했어요.');
  }
  return (await response.json()) as T;
}
