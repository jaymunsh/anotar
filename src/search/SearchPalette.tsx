import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight,
  FileImage,
  FileText,
  Paperclip,
  Search,
  WandSparkles,
  X,
} from 'lucide-react';
import { subscribeRecordChanges } from '../trash/events';
import { fetchSearch } from './api';
import type { SearchBatch, SearchItem, SearchType } from './types';
import './search.css';
import { workspaceCommands, type WorkspaceCommandId } from './commands';

const filters: { id: SearchType; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'memo', label: '메모' },
  { id: 'page', label: '페이지' },
  { id: 'file', label: '파일' },
  { id: 'ai', label: 'AI 요청' },
  { id: 'result', label: 'AI 결과' },
  { id: 'task', label: '할 일' },
  { id: 'ocr', label: 'OCR' },
];
const labels = {
  memo: '메모',
  page: '페이지',
  file: '파일',
  ai: 'AI 요청',
  result: 'AI 결과',
  task: '할 일',
  ocr: 'OCR',
};
const emptyBatch: SearchBatch = { items: [], nextCursor: null, reset: false, reason: null };

export default function SearchPalette({
  onClose,
  onNavigate,
  onCommand,
  pageId,
}: {
  onClose: () => void;
  onNavigate: (path: string) => void;
  onCommand?: (id: WorkspaceCommandId) => void;
  pageId?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'search' | 'commands'>('search');
  const commands = workspaceCommands(query, Boolean(pageId));
  function executeCommand(id: WorkspaceCommandId) {
    onClose();
    onCommand?.(id);
  }
  const [type, setType] = useState<SearchType>('all');
  const [batch, setBatch] = useState<SearchBatch>(emptyBatch);
  const resultCount = mode === 'commands' ? commands.length : batch.items.length;
  const [index, setIndex] = useState(0);
  const [composing, setComposing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<'initial' | 'more' | null>(null);
  const [reload, setReload] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const listId = useId();
  const short =
    query.trim().length > 0 &&
    !query
      .trim()
      .split(/\s+/u)
      .some((word) => Array.from(word.normalize('NFC')).length >= 2);

  function invalidate() {
    ++generation.current;
    controller.current?.abort();
    setBatch(emptyBatch);
    setIndex(0);
    setMore(false);
    setError(null);
  }
  function changeQuery(value: string) {
    invalidate();
    setQuery(value);
  }
  function changeType(value: SearchType) {
    if (type !== value) {
      invalidate();
      setType(value);
    }
  }

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    input.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      const closedMobileSidebar =
        window.matchMedia('(max-width: 760px)').matches &&
        opener?.closest('.sidebar:not(.sidebar-open)');
      const target = closedMobileSidebar
        ? document.querySelector<HTMLElement>('.mobile-menu')
        : opener;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => subscribeRecordChanges(() => setReload((value) => value + 1)), []);

  useEffect(() => {
    const token = ++generation.current;
    controller.current?.abort();
    setBatch(emptyBatch);
    setIndex(0);
    setMore(false);
    setError(null);
    setLoading(mode === 'search' && !composing && !short);
    if (mode === 'commands' || composing || short) return;
    const abort = new AbortController();
    controller.current = abort;
    const timer = window.setTimeout(
      () => {
        void fetchSearch(query, type, null, abort.signal)
          .then((data) => {
            if (generation.current !== token) return;
            setBatch(data);
            setLoading(false);
          })
          .catch(() => {
            if (generation.current !== token || abort.signal.aborted) return;
            setError('initial');
            setLoading(false);
          });
      },
      query.trim() ? 200 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.current?.abort();
      ++generation.current;
    };
  }, [query, type, reload, composing, short, mode]);

  useEffect(() => {
    panel.current
      ?.querySelector(`[id="${CSS.escape(listId + '-' + index)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [index, listId]);

  async function loadMore() {
    if (more || !batch.nextCursor) return;
    const token = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setMore(true);
    setError(null);
    try {
      const data = await fetchSearch(query, type, batch.nextCursor, abort.signal);
      if (generation.current !== token) return;
      setBatch((current) => ({
        ...data,
        items: data.reset
          ? data.items
          : [...current.items, ...data.items].filter(
              (item, position, all) =>
                all.findIndex((other) => other.type === item.type && other.id === item.id) ===
                position,
            ),
      }));
      if (data.reset) setIndex(0);
      setMore(false);
    } catch {
      if (generation.current !== token || abort.signal.aborted) return;
      setError('more');
      setMore(false);
    }
  }
  function open(item: SearchItem) {
    onNavigate(item.href);
    onClose();
  }
  function trapTab(event: React.KeyboardEvent) {
    if (event.key === 'Escape' && !composing && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = panel.current?.querySelectorAll<HTMLElement>(
      'input, button:not([disabled]):not([tabindex="-1"])',
    );
    if (!controls?.length) return;
    const first = controls[0],
      last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className="page-search-backdrop unified-search"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className="page-search-panel"
        role="dialog"
        aria-modal="true"
        aria-label="통합 검색"
        onKeyDown={trapTab}
      >
        <div className="page-search-input">
          <Search size={18} aria-hidden />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={index < resultCount ? listId + '-' + index : undefined}
            value={query}
            maxLength={160}
            aria-label="통합 검색어"
            placeholder={mode === 'commands' ? '실행할 작업 찾기' : '메모, 페이지, 파일 찾기'}
            onChange={(event) => changeQuery(event.target.value)}
            onCompositionStart={() => {
              invalidate();
              setComposing(true);
            }}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(event) => {
              if (composing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
                return;
              if (event.key === 'ArrowDown' && resultCount) {
                event.preventDefault();
                setIndex((value) => Math.min(value + 1, resultCount - 1));
              }
              if (event.key === 'ArrowUp' && resultCount) {
                event.preventDefault();
                setIndex((value) => Math.max(value - 1, 0));
              }
              if (event.key === 'Enter' && index < resultCount) {
                event.preventDefault();
                if (mode === 'commands') executeCommand(commands[index].id);
                else open(batch.items[index]);
              }
            }}
          />
          <button type="button" className="search-close" aria-label="검색 닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {onCommand && (
          <div className="search-modes" aria-label="검색 또는 작업">
            <button
              type="button"
              aria-pressed={mode === 'search'}
              onClick={() => {
                invalidate();
                setMode('search');
                input.current?.focus();
              }}
            >
              기록 검색
            </button>
            <button
              type="button"
              aria-pressed={mode === 'commands'}
              onClick={() => {
                invalidate();
                setMode('commands');
                input.current?.focus();
              }}
            >
              빠른 작업
            </button>
          </div>
        )}
        {mode === 'search' && (
          <div className="search-filters" role="tablist" aria-label="검색 범위">
            {filters.map((filter, position) => (
              <button
                key={filter.id}
                type="button"
                role="tab"
                aria-selected={type === filter.id}
                tabIndex={type === filter.id ? 0 : -1}
                onClick={() => changeType(filter.id)}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? filters.length - 1
                        : (position + (event.key === 'ArrowRight' ? 1 : -1) + filters.length) %
                          filters.length;
                  changeType(filters[next].id);
                  (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
                }}
              >
                {filter.label}
              </button>
            ))}
          </div>
        )}
        {batch.scope === 'local' && <p className="search-local-scope" role="status">이 기기에 보관한 항목</p>}
        <div className="search-results-scroll" aria-busy={loading || more}>
          <div className="page-search-results" id={listId} role="listbox" aria-label="검색 결과">
            {mode === 'commands' &&
              commands.map((command, position) => (
                <button
                  key={command.id}
                  type="button"
                  id={listId + '-' + position}
                  role="option"
                  aria-selected={index === position}
                  tabIndex={-1}
                  className={'page-search-result' + (index === position ? ' active' : '')}
                  onMouseEnter={() => setIndex(position)}
                  onClick={() => executeCommand(command.id)}
                >
                  <span className="page-search-result-icon" aria-hidden>
                    <ArrowUpRight size={18} />
                  </span>
                  <span className="search-result-copy">
                    <span className="page-search-result-title">{command.label}</span>
                    <span className="search-snippet">{command.hint}</span>
                  </span>
                </button>
              ))}
            {mode === 'search' &&
              batch.items.map((item, position) => {
                const context =
                  item.context === labels[item.type] || item.context === item.label
                    ? ''
                    : item.type === 'ai'
                      ? item.context.replace(/^AI 요청 · /, '')
                      : item.type === 'page' && item.context.endsWith(' / ' + item.label)
                        ? item.context.slice(0, -item.label.length - 3)
                        : item.context;
                const Icon =
                  item.type === 'ai'
                    ? WandSparkles
                    : item.type === 'file'
                      ? item.kind.startsWith('image/')
                        ? FileImage
                        : Paperclip
                      : FileText;
                return (
                  <button
                    key={item.type + item.id}
                    id={listId + '-' + position}
                    type="button"
                    role="option"
                    aria-selected={index === position}
                    tabIndex={-1}
                    className={'page-search-result' + (index === position ? ' active' : '')}
                    onMouseEnter={() => setIndex(position)}
                    onClick={() => open(item)}
                  >
                    <span className="page-search-result-icon" aria-hidden>
                      {item.icon || <Icon size={18} />}
                    </span>
                    <span className="search-result-copy">
                      <span className="search-result-meta">
                        <span>{labels[item.type]}</span>
                        {context && <span className="search-context">{context}</span>}
                      </span>
                      <span className="page-search-result-title">{item.label}</span>
                      {item.snippet && item.snippet !== item.label && (
                        <span className="search-snippet">{item.snippet}</span>
                      )}
                    </span>
                    <ArrowUpRight className="search-open-icon" size={16} aria-hidden />
                  </button>
                );
              })}
          </div>
          <div role="status" aria-live="polite" className="search-status">
            {mode === 'commands' ? (
              commands.length ? null : (
                <p>일치하는 작업이 없어요.</p>
              )
            ) : composing ? (
              <p>검색어를 입력하는 중…</p>
            ) : short || batch.reason === 'short_query' ? (
              <p>두 글자 이상 입력해 주세요.</p>
            ) : loading ? (
              <p>찾는 중…</p>
            ) : error ? (
              <div className="search-error">
                <p>검색을 불러오지 못했어요.</p>
                <button
                  type="button"
                  onClick={() =>
                    error === 'more' ? void loadMore() : setReload((value) => value + 1)
                  }
                >
                  다시 불러오기
                </button>
              </div>
            ) : !batch.items.length ? (
              <p>일치하는 기록이 없어요.</p>
            ) : batch.reset ? (
              <p>기록이 바뀌어 처음부터 불러왔어요.</p>
            ) : null}
          </div>
          {mode === 'search' && batch.nextCursor && !error && (
            <button
              type="button"
              className="search-more"
              disabled={more}
              onClick={() => void loadMore()}
            >
              {more ? '불러오는 중…' : '더 보기'}
            </button>
          )}
        </div>
        <p className="page-search-foot">
          {mode === 'commands'
            ? '실행할 작업을 선택하세요'
            : query.trim()
              ? '메모 · 페이지 본문 · 파일명'
              : '최근 기록'}
          <span>↑↓ 선택 · Enter 열기 · Esc 닫기</span>
        </p>
      </div>
    </div>,
    document.body,
  );
}
