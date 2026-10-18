// 온라인 전용 저장 계층. 서버가 원본이며 저장은 서버 응답 성공, 읽기는 서버 GET이다.
// 예전 기기 우선(local-first) 동기화(IndexedDB entities/outbox/summaries, sync 엔진)는 제거했다.
// workspaceFetch는 이전 호출부 이름을 유지한 fetch 래퍼다.

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

// 서버 저장을 직접 수행하는 fetch 래퍼. 예전 workspaceFetch 자리에서 이름을 유지한다.
export async function workspaceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, init);
}
