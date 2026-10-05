import { onlineActionFetch } from '../sync/onlineActions';
import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { publishRecordChange } from '../trash/events';
export type PlanRelation = {
  id: string;
  blockId: string;
  entryId: string;
  entryTitle: string;
  kind: 'task' | 'page' | 'memo';
  targetId: string;
  shared: boolean;
  version: number;
  sourceMissing: boolean;
  unavailable: boolean;
  title: string;
  task: {
    id: string;
    title: string;
    status: 'open' | 'done';
    version: number;
    dueDate: string | null;
  } | null;
};
type Mutation = Record<string, unknown> & { blockId: string; entryId: string; action: string };
type Context = {
  pageId: string;
  items: PlanRelation[];
  loading: boolean;
  busy: boolean;
  error: string;
  pending: Mutation | null;
  refresh: () => void;
  refreshAll: () => void;
  change: (value: Mutation) => Promise<boolean>;
  retry: () => Promise<boolean>;
  discard: () => void;
};
export const PlanConnectionsContext = createContext<Context | null>(null);
export function hasItineraryBlocks(blocks: readonly unknown[]): boolean {
  return blocks.some((value) => {
    if (!value || typeof value !== 'object') return false;
    const block = value as { type?: unknown; children?: unknown };
    return (
      block.type === 'itinerary' ||
      (Array.isArray(block.children) && hasItineraryBlocks(block.children))
    );
  });
}
export function PlanConnectionsProvider({
  pageId,
  pageVersion,
  enabled = true,
  children,
}: {
  pageId: string;
  pageVersion: number;
  enabled?: boolean;
  children: ReactNode;
}) {
  const [items, setItems] = useState<PlanRelation[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [pending, setPending] = useState<Mutation | null>(null);
  const latest = useRef({ pageId, pageVersion });
  const lastSavedVersion = useRef(pageVersion);
  latest.current = { pageId, pageVersion };
  const pendingRef = useRef<Mutation | null>(null),
    busyRef = useRef(false),
    epoch = useRef(0),
    controller = useRef<AbortController | null>(null);
  const key = 'leneu:plan-connections-pending:v1:' + pageId;
  const retain = useCallback(
    (value: Mutation | null) => {
      pendingRef.current = value;
      setPending(value);
      try {
        if (value) sessionStorage.setItem(key, JSON.stringify(value));
        else sessionStorage.removeItem(key);
      } catch {
        /* Pending snapshot still lives in memory. */
      }
    },
    [key],
  );
  const load = useCallback(
    (force = false) => {
      if (!enabled && !force) {
        setLoading(false);
        return;
      }
      if (busyRef.current || pendingRef.current) return;
      const revision = ++epoch.current;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setLoading(true);
      setError('');
      void fetch(`/api/pages/${pageId}/plan-connections`, { signal: abort.signal })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok || !Array.isArray(data.items)) throw new Error();
          if (!abort.signal.aborted && revision === epoch.current) setItems(data.items);
        })
        .catch(() => {
          if (!abort.signal.aborted && revision === epoch.current)
            setError('일정 연결을 불러오지 못했어요. 다시 확인해 주세요.');
        })
        .finally(() => {
          if (revision === epoch.current) setLoading(false);
        });
    },
    [pageId, enabled],
  );
  const refresh = useCallback(() => load(), [load]);
  const refreshAll = useCallback(() => load(true), [load]);
  useEffect(() => {
    lastSavedVersion.current = latest.current.pageVersion;
    setItems([]);
    setError('');
    setPending(null);
    pendingRef.current = null;
    try {
      const value = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (
        value &&
        value.pageId === pageId &&
        typeof value.requestId === 'string' &&
        typeof value.blockId === 'string' &&
        typeof value.entryId === 'string'
      ) {
        pendingRef.current = value;
        setPending(value);
        setLoading(false);
      }
    } catch {
      /* Ignore malformed drafts. */
    }
    if (!pendingRef.current) refresh();
    else setError('확인하지 못한 연결 요청이 있어요. 같은 요청을 다시 시도할 수 있어요.');
    return () => {
      ++epoch.current;
      controller.current?.abort();
    };
  }, [pageId, key, refresh]);
  useEffect(() => {
    if (lastSavedVersion.current === pageVersion) return;
    lastSavedVersion.current = pageVersion;
    if (enabled && !busyRef.current && !pendingRef.current) refresh();
  }, [pageVersion, enabled, refresh]);
  const send = async (snapshot: Mutation): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    retain(snapshot);
    const ownPage = latest.current.pageId;
    const previousItems = items;
    if (snapshot.action === 'toggle-task' && ['open', 'done'].includes(String(snapshot.status)))
      setItems((current) =>
        current.map((row) =>
          row.id === snapshot.relationId && row.task
            ? { ...row, task: { ...row.task, status: snapshot.status as 'open' | 'done' } }
            : row,
        ),
      );
    if (snapshot.action === 'share' && typeof snapshot.shared === 'boolean')
      setItems((current) =>
        current.map((row) =>
          row.id === snapshot.relationId ? { ...row, shared: snapshot.shared as boolean } : row,
        ),
      );
    ++epoch.current;
    controller.current?.abort();
    try {
      const response = await onlineActionFetch(`/api/pages/${ownPage}/plan-connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.items)) {
        if (response.status === 409) {
          retain(null);
          throw new Error(
            data.error || '일정이나 할 일이 변경됐어요. 다시 불러온 뒤 확인해 주세요.',
          );
        }
        throw new Error(
          data.error || '연결을 저장하지 못했어요. 같은 요청으로 다시 시도해 주세요.',
        );
      }
      if (latest.current.pageId === ownPage) {
        setItems(data.items);
        retain(null);
        setLoading(false);
        publishRecordChange('plan-connections');
      }
      return true;
    } catch (e) {
      if (latest.current.pageId === ownPage) {
        setItems(previousItems);
        setError(
          e instanceof SyntaxError || e instanceof TypeError
            ? '연결을 저장하지 못했어요. 같은 요청으로 다시 시도해 주세요.'
            : e instanceof Error
              ? e.message
              : '연결을 저장하지 못했어요.',
        );
      }
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const change = async (value: Mutation) => {
    if (pendingRef.current || busyRef.current) return false;
    return send({
      ...value,
      pageId,
      expectedPageVersion: pageVersion,
      requestId: crypto.randomUUID(),
    });
  };
  const retry = async () => (pendingRef.current ? send(pendingRef.current) : false);
  const discard = () => {
    if (busyRef.current) return;
    retain(null);
    refreshAll();
  };
  return (
    <PlanConnectionsContext.Provider
      value={{
        pageId,
        items,
        loading,
        busy,
        error,
        pending,
        refresh,
        refreshAll,
        change,
        retry,
        discard,
      }}
    >
      {children}
    </PlanConnectionsContext.Provider>
  );
}
