import { useEffect, useRef, useState } from 'react';
import { subscribeRecordChanges } from '../trash/events';
import { fetchCommentInbox } from './api';
import type { CommentInboxBatch, CommentInboxView } from './types';
export function useCommentInbox(view: CommentInboxView, compact: boolean) {
  const [data, setData] = useState<(CommentInboxBatch & { view: CommentInboxView }) | null>(null);
  const [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [moreBusy, setMoreBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const surface = useRef<HTMLElement>(null);
  const epoch = useRef(0);
  const moreController = useRef<AbortController | null>(null);
  const moreLock = useRef(false);
  useEffect(() => {
    const generation = ++epoch.current;
    let stopped = false,
      visible = false;
    let timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined;
    setError('');
    setLoading(true);
    moreController.current?.abort();
    moreLock.current = false;
    setMoreBusy(false);
    async function refresh() {
      if (stopped || !visible || document.hidden) return;
      clearTimeout(timer);
      controller?.abort();
      moreController.current?.abort();
      const current = new AbortController();
      controller = current;
      setLoading(true);
      try {
        const batch = await fetchCommentInbox(view, compact ? 3 : 20, null, current.signal);
        if (stopped || current.signal.aborted || generation !== epoch.current) return;
        setData({ ...batch, view });
        setError('');
        setCheckedAt(new Date().toISOString());
      } catch {
        if (!stopped && !current.signal.aborted && generation === epoch.current)
          setError('공유 댓글을 갱신하지 못했어요. 다시 불러와 주세요.');
      } finally {
        if (
          !stopped &&
          generation === epoch.current &&
          controller === current &&
          !current.signal.aborted
        )
          setLoading(false);
        if (
          compact &&
          !stopped &&
          visible &&
          !document.hidden &&
          controller === current &&
          !current.signal.aborted
        )
          timer = setTimeout(() => void refresh(), 30000);
      }
    }
    const schedule = () => {
      clearTimeout(timer);
      controller?.abort();
      moreController.current?.abort();
      if (!stopped && visible && !document.hidden) timer = setTimeout(() => void refresh(), 0);
    };
    const observer = new IntersectionObserver((entries) => {
      const next = entries.some((entry) => entry.isIntersecting);
      if (next !== visible) {
        visible = next;
        schedule();
      }
    });
    if (surface.current) observer.observe(surface.current);
    document.addEventListener('visibilitychange', schedule);
    const unsubscribe = subscribeRecordChanges(schedule);
    return () => {
      stopped = true;
      ++epoch.current;
      clearTimeout(timer);
      controller?.abort();
      moreController.current?.abort();
      observer.disconnect();
      unsubscribe();
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [view, compact, reload]);
  async function loadMore() {
    if (compact || moreLock.current || loading || data?.view !== view || !data.nextCursor) return;
    const generation = epoch.current,
      cursor = data.nextCursor,
      current = new AbortController();
    moreController.current?.abort();
    moreController.current = current;
    moreLock.current = true;
    setMoreBusy(true);
    setError('');
    try {
      const batch = await fetchCommentInbox(view, 20, cursor, current.signal);
      if (current.signal.aborted || generation !== epoch.current) return;
      setData((previous) => {
        if (!previous || previous.view !== view || previous.nextCursor !== cursor) return previous;
        const ids = new Set(previous.items.map((item) => item.threadId));
        return {
          ...batch,
          view,
          items: [...previous.items, ...batch.items.filter((item) => !ids.has(item.threadId))],
        };
      });
    } catch {
      if (!current.signal.aborted && generation === epoch.current)
        setError('다음 댓글을 불러오지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (generation === epoch.current) {
        moreLock.current = false;
        setMoreBusy(false);
      }
    }
  }
  return {
    surface,
    data: data?.view === view ? data : null,
    error,
    checkedAt,
    loading,
    moreBusy,
    loadMore,
    retry: () => setReload((value) => value + 1),
  };
}
