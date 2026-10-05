import { WorkspaceToolbar } from '../workspace/WorkspaceToolbar';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, FileText, RotateCcw, RefreshCw } from 'lucide-react';
import { formatKoreanTime } from '../time';
import type { TrashEntry } from './types';
import { useTrashOperation } from './useTrashOperation';
import { publishRecordChange, subscribeRecordChanges } from './events';
import './trash.css';

type Filter = 'all' | 'capture' | 'page';
const filters = [
  { id: 'all', label: '전체' },
  { id: 'capture', label: '메모' },
  { id: 'page', label: '페이지' },
] as const;
const pathFor = (entry: TrashEntry) =>
  entry.kind === 'page' ? `/pages/${entry.targetId}` : entry.isAi ? '/memo?view=ai' : '/memo';

function TrashRow({
  entry,
  onRestored,
}: {
  entry: TrashEntry;
  onRestored: (entry: TrashEntry) => void;
}) {
  const operation = useTrashOperation();
  async function restore() {
    const restored = await operation.run(() => ({
      path: `/api/trash/${entry.id}/restore`,
      body: { operationId: crypto.randomUUID() },
    }));
    if (restored) onRestored(restored);
  }
  return (
    <article className="trash-row">
      <span className="trash-row-icon" aria-hidden>
        {entry.icon || <FileText size={19} />}
      </span>
      <div className="trash-row-main">
        <div className="trash-row-meta">
          <span>{entry.kind === 'page' ? '페이지' : entry.isAi ? 'AI 요청' : '메모'}</span>
          <span>
            이동 <time dateTime={entry.deletedAt}>{formatKoreanTime(entry.deletedAt)}</time>
          </span>
        </div>
        <p className="trash-row-label" title={entry.label}>
          {entry.label}
        </p>
        {entry.preview && (
          <p className="trash-row-preview" title={entry.preview}>
            {entry.preview}
          </p>
        )}
      </div>
      <button className="trash-restore" disabled={operation.busy} onClick={() => void restore()}>
        <RotateCcw size={15} />
        {operation.busy ? '확인 중…' : operation.pending ? '같은 요청 다시 확인' : '복원'}
      </button>
      {operation.error && (
        <p className="trash-restore-error" role="alert">
          {operation.error}
        </p>
      )}
    </article>
  );
}

export default function TrashWorkspace({ navigate }: { navigate: (path: string) => void }) {
  const [type, setType] = useState<Filter>('all');
  const [items, setItems] = useState<TrashEntry[]>([]);
  const [counts, setCounts] = useState({ all: 0, capture: 0, page: 0 });
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [restored, setRestored] = useState<TrashEntry | null>(null);
  const generation = useRef(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const restoredLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    restoredLink.current?.focus();
  }, [restored]);

  async function load(nextCursor: string | null, current = ++generation.current) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ type });
      if (nextCursor) params.set('cursor', nextCursor);
      const response = await fetch('/api/trash?' + params);
      const data = (await response.json()) as {
        items: TrashEntry[];
        counts: typeof counts;
        nextCursor: string | null;
      };
      if (!response.ok || !Array.isArray(data.items) || !data.counts) throw new Error();
      if (generation.current !== current) return;
      setItems((old) =>
        nextCursor
          ? [
              ...old,
              ...data.items.filter((item) => !old.some((previous) => previous.id === item.id)),
            ]
          : data.items,
      );
      setCounts(data.counts);
      setCursor(data.nextCursor);
    } catch {
      if (generation.current === current)
        setError('휴지통을 불러오지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    setItems([]);
    setCursor(null);
    void load(null);
    const unsubscribe = subscribeRecordChanges((source) => {
      if (source !== 'trash-list') void load(null);
    });
    return () => {
      ++generation.current;
      unsubscribe();
    };
  }, [type, retry]);

  function onRestored(entry: TrashEntry) {
    setItems((old) => old.filter((item) => item.id !== entry.id));
    setCounts((old) => ({
      ...old,
      all: Math.max(0, old.all - 1),
      [entry.kind]: Math.max(0, old[entry.kind] - 1),
    }));
    setRestored(entry);
    // Invalidate older reads and refresh the selected filter, even if it changed during POST.
    void latestLoad.current(null);
    publishRecordChange('trash-list');
  }
  return (
    <main className="trash-workspace">
      <WorkspaceToolbar title="휴지통">
        <button
          type="button"
          className="toolbar-icon-mobile"
          aria-label="휴지통 새로고침"
          title="휴지통 새로고침"
          disabled={loading}
          onClick={() => void latestLoad.current(null)}
        >
          <RefreshCw size={16} />
          <span>새로고침</span>
        </button>
      </WorkspaceToolbar>
      <p className="workspace-hint">옮겨둔 메모와 페이지를 다시 꺼내세요.</p>
      <div className="trash-tabs" role="tablist" aria-label="휴지통 목록">
        {filters.map((filter, index) => (
          <button
            key={filter.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            role="tab"
            aria-selected={type === filter.id}
            aria-controls="trash-items"
            tabIndex={type === filter.id ? 0 : -1}
            onClick={() => setType(filter.id)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % 3
                  : event.key === 'ArrowLeft'
                    ? (index + 2) % 3
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? 2
                        : null;
              if (next !== null) {
                event.preventDefault();
                setType(filters[next].id);
                tabRefs.current[next]?.focus();
              }
            }}
          >
            {filter.label}
            <span>{counts[filter.id]}</span>
          </button>
        ))}
      </div>
      <p className="trash-help">
        페이지는 묶인 하위 문서와 함께 복원돼요. 상위 페이지가 휴지통에 있으면 최상위에 복원돼요.
      </p>
      {restored && (
        <p className="trash-restored" role="status">
          복원했어요.
          <a
            ref={restoredLink}
            href={pathFor(restored)}
            onClick={(event) => {
              event.preventDefault();
              navigate(pathFor(restored));
            }}
          >
            열기 <ArrowUpRight size={14} />
          </a>
        </p>
      )}
      {error && (
        <div className="trash-list-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setRetry((value) => value + 1)}>다시 불러오기</button>
        </div>
      )}
      <section
        id="trash-items"
        role="tabpanel"
        aria-label={filters.find((filter) => filter.id === type)?.label}
        aria-busy={loading}
        className="trash-list"
      >
        {items.map((entry) => (
          <TrashRow key={entry.id} entry={entry} onRestored={onRestored} />
        ))}
        {!loading && !error && !items.length && (
          <p className="trash-empty">
            {type === 'all'
              ? '휴지통이 비어 있어요.'
              : type === 'page'
                ? '휴지통에 페이지가 없어요.'
                : '휴지통에 메모가 없어요.'}
          </p>
        )}
        {loading && (
          <p className="trash-loading" role="status">
            휴지통을 불러오는 중…
          </p>
        )}
      </section>
      {cursor && !error && (
        <button className="trash-more" disabled={loading} onClick={() => void load(cursor)}>
          더 보기
        </button>
      )}
    </main>
  );
}
