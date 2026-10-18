// 온라인 전용 저장 계층. 서버가 원본이며 저장은 서버 응답 성공, 읽기는 서버 GET이다.
// 예전 기기 우선(local-first) 동기화(IndexedDB entities/outbox/summaries, sync 엔진)는 제거했다.
// workspaceFetch는 이전 호출부 호환을 위해 이름을 유지하되 이제 그대로 fetch로 넘긴다.
import type { SyncEntityKind } from '../../shared/sync.ts';

// 연결 상태만 가볍게 보여주기 위한 스냅샷. 충돌·대기 개념은 더 이상 없다.
export type ConnectionSnapshot = {
  state: 'ready' | 'offline';
  pending: 0;
  conflicts: 0;
  error: '';
  lastSync: null;
};

const listeners = new Set<() => void>();
let snapshot: ConnectionSnapshot = {
  state: navigator.onLine ? 'ready' : 'offline',
  pending: 0,
  conflicts: 0,
  error: '',
  lastSync: null,
};

function notify() {
  listeners.forEach((fn) => fn());
}

function setOnline(online: boolean) {
  const next: ConnectionSnapshot['state'] = online ? 'ready' : 'offline';
  if (snapshot.state === next) return;
  snapshot = { ...snapshot, state: next };
  notify();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
}

export const getSyncSnapshot = () => snapshot;

export function subscribeSync(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// 예전 복구 흐름 호환용 no-op. 서버 원본만 쓰므로 할 일이 없다.
export function reportRecovery() {}

// 자산은 이제 서버 URL을 직접 쓴다.
export async function localAssetUrl(id: string) {
  return `/api/assets/${id}`;
}

// 예전 workspace 런타임 자리. 호출부 호환을 위해 최소 정보만 돌려준다.
export async function getWorkspaceRuntime() {
  return { workspaceId: 'local', deviceId: 'online' };
}

export async function resetRuntimeBinding() {
  return getWorkspaceRuntime();
}

// 페이지 목록은 서버에서 직접 읽는다. (예전 listLocalEntities 호환)
export async function listLocalEntities(
  kind: SyncEntityKind,
  _limit = 50,
): Promise<{ id: string; current: Record<string, unknown> }[]> {
  if (kind !== 'page') return [];
  const response = await fetch('/api/pages');
  if (!response.ok) throw new Error('목록을 불러오지 못했어요.');
  const data = (await response.json()) as { items: { id: string; [key: string]: unknown }[] };
  return (data.items ?? []).map((item) => ({ id: item.id, current: item }));
}

// 온라인 전용에서는 별도 동기화 요청이 필요 없다. 호출부 호환용.
export async function requestWorkspaceSync() {}

export async function enqueueCurrentEntity(_kind: 'page', _id: string) {}
export async function enqueueCurrentPage(_id: string) {}

// 서버 저장을 직접 수행하는 fetch 래퍼. 예전 workspaceFetch 자리에서 이름을 유지한다.
export async function workspaceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, init);
}
