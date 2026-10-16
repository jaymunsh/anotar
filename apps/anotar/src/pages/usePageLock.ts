import { useEffect, useRef, useState } from 'react';
import { canPerformOnlineAction } from '../sync/onlineActions';
import type { PageRecord } from './types';

type LockState = { locked: boolean; lockVersion: number };
function cached(page: PageRecord): LockState {
  try {
    const value = JSON.parse(localStorage.getItem(`anotar:page-lock:${page.id}`) || 'null');
    if (typeof value?.locked === 'boolean' && Number.isSafeInteger(value.lockVersion) &&
      value.lockVersion > (page.lockVersion ?? -1)) return value;
  } catch {}
  return { locked: Boolean(page.locked), lockVersion: page.lockVersion ?? 0 };
}

export function usePageLock(page: PageRecord) {
  const [state, setState] = useState(() => cached(page));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const stateRef = useRef(state), pendingRef = useRef(false), sequence = useRef(0);
  const alive = useRef(true);
  function accept(value: LockState) {
    if (!alive.current) return;
    const next = { locked: value.locked, lockVersion: value.lockVersion };
    if (stateRef.current.locked === next.locked && stateRef.current.lockVersion === next.lockVersion) return;
    stateRef.current = next; setState(next);
    try { localStorage.setItem(`anotar:page-lock:${page.id}`, JSON.stringify(next)); } catch {}
  }
  async function refresh() {
    if (pendingRef.current || !navigator.onLine || document.hidden) return;
    const current = ++sequence.current;
    try {
      const response = await fetch(`/api/pages/${page.id}/lock`);
      if (!response.ok) return;
      const { item } = await response.json();
      if (current === sequence.current && !pendingRef.current) accept(item);
    } catch { /* Keep the last confirmed lock available offline. */ }
  }
  useEffect(() => {
    alive.current = true;
    void refresh();
    const update = () => void refresh();
    const timer = window.setInterval(update, 30000);
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      alive.current = false; ++sequence.current; clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [page.id]);
  useEffect(() => {
    if ((page.lockVersion ?? 0) > stateRef.current.lockVersion)
      accept({ locked: Boolean(page.locked), lockVersion: page.lockVersion! });
  }, [page.locked, page.lockVersion]);

  async function toggle(expectedVersion: number) {
    if (pendingRef.current) return;
    pendingRef.current = true; ++sequence.current; setPending(true); setError('');
    const previous = stateRef.current;
    try {
      // Unlock must remain possible when another device locked a pending draft.
      const check = await canPerformOnlineAction(previous.locked ? undefined : 'page', previous.locked ? undefined : page.id);
      if (!check.allowed) throw new Error(check.reason);
      const response = await fetch(`/api/pages/${page.id}/lock`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked: !previous.locked, expectedLockVersion: previous.lockVersion, expectedVersion }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '페이지 잠금을 바꾸지 못했어요.');
      accept(result.item);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : '서버 연결을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      pendingRef.current = false;
      if (alive.current) { setPending(false); void refresh(); }
    }
  }
  return { ...state, pending, error, toggle, refresh };
}
