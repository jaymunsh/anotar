import { useEffect, useState } from 'react';
import type { SyncEntityKind } from '../../shared/sync';
export const ONLINE_REASON = '서버 연결 후 사용할 수 있어요.';
export const PENDING_REASON = '기기의 변경이 서버에 반영된 뒤 사용할 수 있어요.';
export async function canPerformOnlineAction(kind?: SyncEntityKind, id?: string) {
  if (typeof window === 'undefined') return { allowed: true, reason: '' };
  const [{ getWorkspaceRuntime, getSyncSnapshot }, { readLocalEntity }] = await Promise.all([
    import('./runtime.ts'),
    import('./repository.ts'),
  ]);
  if (
    navigator.onLine === false ||
    ['offline', 'access', 'recovery'].includes(getSyncSnapshot().state)
  )
    return { allowed: false, reason: ONLINE_REASON };
  if (kind && id) {
    const { workspaceId } = await getWorkspaceRuntime();
    const record = await readLocalEntity({ workspaceId, kind, id });
    if (record?.dirty) return { allowed: false, reason: PENDING_REASON };
  }
  return { allowed: true, reason: '' };
}
export function useOnlineAction(kind?: SyncEntityKind, id?: string) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    let active = true;
    const disposers: (() => void)[] = [];
    const refresh = () =>
      void canPerformOnlineAction(kind, id)
        .then((result) => {
          if (active) setReason(result.reason);
        })
        .catch(() => {
          if (active) setReason(ONLINE_REASON);
        });
    refresh();
    void Promise.all([import('./runtime.ts'), import('./repository.ts')]).then(
      ([runtime, repo]) => {
        if (active)
          disposers.push(runtime.subscribeSync(refresh), repo.subscribeLocalChanges(refresh));
      },
    );
    window.addEventListener('offline', refresh);
    window.addEventListener('online', refresh);
    return () => {
      active = false;
      disposers.forEach((off) => off());
      window.removeEventListener('offline', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [kind, id]);
  return reason;
}
export async function onlineActionFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!init.method || init.method === 'GET') return fetch(path, init);
  const match = path.match(/^\/api\/(pages|captures|tasks)\/([a-f0-9-]+)/);
  const kind =
    match?.[1] === 'pages'
      ? 'page'
      : match?.[1] === 'captures'
        ? 'capture'
        : match?.[1] === 'tasks'
          ? 'task'
          : undefined;
  const check = await canPerformOnlineAction(kind, match?.[2]);
  let targetCheck = check;
  if (check.allowed && typeof init.body === 'string')
    try {
      const body = JSON.parse(init.body);
      for (const id of [body.pageId, body.targetPageId, body.parentId])
        if (typeof id === 'string') {
          const target = await canPerformOnlineAction('page', id);
          if (!target.allowed) {
            targetCheck = target;
            break;
          }
        }
      if (targetCheck.allowed && Array.isArray(body.items))
        for (const item of body.items) {
          if (typeof item.captureId === 'string') {
            const source = await canPerformOnlineAction('capture', item.captureId);
            if (!source.allowed) {
              targetCheck = source;
              break;
            }
          }
        }
    } catch {}
  if (!targetCheck.allowed)
    return new Response(
      JSON.stringify({ error: targetCheck.reason, code: 'online_action_blocked' }),
      { status: 412, headers: { 'Content-Type': 'application/json' } },
    );
  return fetch(path, init);
}
