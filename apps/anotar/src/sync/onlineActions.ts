import { useEffect, useState } from 'react';
import type { SyncEntityKind } from '../../shared/sync';

// 온라인 전용 가드. 예전 기기 변경 대기(pending) 개념은 사라졌고 연결 여부만 확인한다.
export const ONLINE_REASON = '서버 연결 후 사용할 수 있어요.';

export async function canPerformOnlineAction(_kind?: SyncEntityKind, _id?: string) {
  if (typeof window === 'undefined') return { allowed: true, reason: '' };
  if (navigator.onLine === false) return { allowed: false, reason: ONLINE_REASON };
  return { allowed: true, reason: '' };
}

export function useOnlineAction(_kind?: SyncEntityKind, _id?: string) {
  const [reason, setReason] = useState(
    typeof navigator !== 'undefined' && navigator.onLine === false ? ONLINE_REASON : '',
  );
  useEffect(() => {
    const refresh = () => setReason(navigator.onLine === false ? ONLINE_REASON : '');
    refresh();
    window.addEventListener('offline', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener('offline', refresh);
      window.removeEventListener('online', refresh);
    };
  }, []);
  return reason;
}

// 쓰기 요청 전 연결만 확인하는 단순 래퍼. (예전 오프라인 가드 대체)
export async function onlineActionFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (init.method && init.method !== 'GET' && navigator.onLine === false)
    return new Response(JSON.stringify({ error: ONLINE_REASON, code: 'online_action_blocked' }), {
      status: 412,
      headers: { 'Content-Type': 'application/json' },
    });
  return fetch(path, init);
}
