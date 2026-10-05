import { useEffect, useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { fetchSearch } from '../search/api';
import type { SearchBatch, SearchItem } from '../search/types';
import { workspaceFetch } from '../sync/runtime';
import { cachedRequest } from '../sync/cachedRequest';
import { renderPageMarkdown } from '../../shared/pageMarkdown';
import type { Capture } from '../memos/types';
import type { AiJob } from '../ai/types';
import { aiPageMarkdown } from '../ai/pageContent';
import type { PageRecord } from './types';
import './pageMaterials.css';

type SourceType = 'memo' | 'page' | 'result';
const scopes: { type: SourceType; label: string }[] = [
  { type: 'memo', label: '메모' },
  { type: 'page', label: '페이지' },
  { type: 'result', label: 'AI 결과' },
];
const empty: SearchBatch = { items: [], nextCursor: null, reset: false, reason: null };

export default function PageMaterialsPanel({
  currentPageId,
  disabled,
  onInsert,
}: {
  currentPageId: string;
  disabled: boolean;
  onInsert: (markdown: string) => void;
}) {
  const [scope, setScope] = useState<SourceType>('memo');
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [batch, setBatch] = useState<SearchBatch>(empty);
  const [searching, setSearching] = useState(true);
  const [more, setMore] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<SearchItem | null>(null);
  const [body, setBody] = useState('');
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState('');
  const [readRetry, setReadRetry] = useState(0);
  const [excerpt, setExcerpt] = useState('');
  const [notice, setNotice] = useState('');
  const [insertError, setInsertError] = useState('');
  const preview = useRef<HTMLTextAreaElement>(null);
  const excerptRef = useRef('');
  const searchGeneration = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const sourceAbort = useRef<AbortController | null>(null);
  const descriptionId = useId();

  function clearSelection() {
    excerptRef.current = '';
    setExcerpt('');
    setNotice('');
    setInsertError('');
  }
  function changeSearch(nextQuery: string, nextScope = scope) {
    if (nextQuery === query && nextScope === scope) return;
    ++searchGeneration.current;
    searchAbort.current?.abort();
    sourceAbort.current?.abort();
    setSelected(null);
    setBody('');
    setReadError('');
    setReading(false);
    clearSelection();
    setQuery(nextQuery);
    setScope(nextScope);
    setBatch(empty);
    setSearching(true);
    setSearchError('');
    setMore(false);
  }

  useEffect(() => {
    const generation = ++searchGeneration.current;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setBatch(empty);
    setSearchError('');
    setMore(false);
    setSearching(!composing);
    if (composing) return () => controller.abort();
    const timer = window.setTimeout(
      () => {
        void fetchSearch(query, scope, null, controller.signal)
          .then((result) => {
            if (controller.signal.aborted || generation !== searchGeneration.current) return;
            setBatch(result);
            setSearching(false);
          })
          .catch(() => {
            if (controller.signal.aborted || generation !== searchGeneration.current) return;
            setSearchError('자료 목록을 불러오지 못했어요.');
            setSearching(false);
          });
      },
      query.trim() ? 220 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      searchAbort.current?.abort();
    };
  }, [query, scope, composing, retry]);

  useEffect(() => {
    const controller = new AbortController();
    sourceAbort.current = controller;
    setBody('');
    setReadError('');
    clearSelection();
    if (!selected) {
      setReading(false);
      return () => controller.abort();
    }
    setReading(true);
    async function load() {
      try {
        let markdown: string;
        if (selected!.type === 'result') {
          const { item } = await cachedRequest<{ item: AiJob }>(
            `/api/ai-jobs/${selected!.id}`,
            controller.signal,
          );
          if (item?.id !== selected!.id || item.status !== 'result_ready' || !item.result)
            throw new Error();
          markdown = aiPageMarkdown(item);
        } else {
          const isPage = selected!.type === 'page';
          const response = await workspaceFetch(
            `/api/${isPage ? 'pages' : 'captures'}/${selected!.id}`,
            { signal: controller.signal },
          );
          if (!response.ok) throw new Error();
          const { item } = (await response.json()) as { item: PageRecord & Capture };
          if (item?.id !== selected!.id) throw new Error();
          markdown = isPage
            ? renderPageMarkdown(item.document.blocks, 0, { includeAppReferences: false })
            : [item.text, item.url].filter(Boolean).join('\n\n');
        }
        if (typeof markdown !== 'string') throw new Error();
        if (controller.signal.aborted) return;
        setBody(markdown);
        setReading(false);
      } catch {
        if (controller.signal.aborted) return;
        setReadError('자료 본문을 불러오지 못했어요. 다시 불러와 주세요.');
        setReading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [selected?.id, selected?.type, readRetry, currentPageId]);

  async function loadMore() {
    if (more || searching || !batch.nextCursor) return;
    const generation = searchGeneration.current;
    const controller = new AbortController();
    searchAbort.current = controller;
    setMore(true);
    setSearchError('');
    try {
      const result = await fetchSearch(query, scope, batch.nextCursor, controller.signal);
      if (controller.signal.aborted || generation !== searchGeneration.current) return;
      setBatch((previous) => ({
        ...result,
        items: result.reset
          ? result.items
          : [...previous.items, ...result.items].filter(
              (item, index, all) =>
                all.findIndex((other) => other.type === item.type && other.id === item.id) ===
                index,
            ),
      }));
    } catch {
      if (!controller.signal.aborted && generation === searchGeneration.current)
        setSearchError('다음 자료를 불러오지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (!controller.signal.aborted && generation === searchGeneration.current) setMore(false);
    }
  }

  function captureExcerpt() {
    const field = preview.current;
    const value = field ? field.value.slice(field.selectionStart, field.selectionEnd) : '';
    excerptRef.current = value;
    setExcerpt(value);
    setNotice('');
  }

  const items = batch.items.filter(
    (item) =>
      ['memo', 'page', 'result'].includes(item.type) &&
      !(item.type === 'page' && item.id === currentPageId),
  );
  return (
    <section className="page-materials" aria-label="문서에 넣을 자료">
      <p className="page-materials-help">
        원본을 읽고 필요한 부분을 본문에 넣으세요. 첨부와 연결된 문서는 함께 복사하지 않아요.
      </p>
      <div className="page-materials-scopes" role="tablist" aria-label="자료 종류">
        {scopes.map((option, index) => (
          <button
            key={option.type}
            type="button"
            role="tab"
            aria-selected={scope === option.type}
            tabIndex={scope === option.type ? 0 : -1}
            onClick={() => changeSearch(query, option.type)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? 2
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
              changeSearch(query, scopes[next].type);
              (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="page-materials-search">
        <Search size={16} aria-hidden />
        <input
          aria-label="자료 검색"
          placeholder="이름이나 내용으로 찾기"
          maxLength={160}
          value={query}
          onChange={(event) => changeSearch(event.target.value)}
          onCompositionStart={() => {
            searchAbort.current?.abort();
            setComposing(true);
          }}
          onCompositionEnd={() => setComposing(false)}
        />
      </label>
      <div className="page-materials-results" aria-busy={searching || more}>
        {items.map((item) => (
          <button
            key={item.type + item.id}
            type="button"
            aria-label={item.label}
            aria-pressed={selected?.id === item.id && selected.type === item.type}
            onClick={() => {
              if (selected?.id === item.id && selected.type === item.type) return;
              sourceAbort.current?.abort();
              setBody('');
              setReading(true);
              setReadError('');
              clearSelection();
              setSelected(item);
            }}
          >
            <strong>{item.label}</strong>
            {item.snippet && item.snippet !== item.label && <span>{item.snippet}</span>}
          </button>
        ))}
      </div>
      <div className="page-materials-status" role="status">
        {composing
          ? '검색어를 입력하는 중…'
          : searching
            ? '자료를 찾는 중…'
            : batch.reason === 'short_query'
              ? '두 글자 이상 입력해 주세요.'
              : !items.length && !searchError
                ? '일치하는 자료가 없어요.'
                : null}
      </div>
      {searchError && (
        <p className="page-materials-error" role="alert">
          {searchError}{' '}
          <button
            type="button"
            onClick={() => (batch.nextCursor ? void loadMore() : setRetry(retry + 1))}
          >
            다시 불러오기
          </button>
        </p>
      )}
      {batch.nextCursor && !searchError && (
        <button
          type="button"
          className="page-materials-more"
          disabled={more || searching}
          onClick={() => void loadMore()}
        >
          {more ? '불러오는 중…' : '자료 더 보기'}
        </button>
      )}
      {selected && (
        <section className="page-materials-preview" aria-label="선택한 자료">
          <h3>{selected.label}</h3>
          <p id={descriptionId}>
            원문에서 넣을 부분을 선택하세요. 선택하지 않으면 본문 전체를 넣어요.
          </p>
          {reading ? (
            <p role="status">원본을 불러오는 중…</p>
          ) : readError ? (
            <p className="page-materials-error" role="alert">
              {readError}{' '}
              <button type="button" onClick={() => setReadRetry(readRetry + 1)}>
                다시 불러오기
              </button>
            </p>
          ) : (
            <>
              <textarea
                ref={preview}
                readOnly
                aria-label="자료 본문"
                aria-describedby={descriptionId}
                value={body}
                onSelect={captureExcerpt}
              />
              {!body.trim() && <p>넣을 텍스트가 없어요. 첨부 파일은 원본에서 확인해 주세요.</p>}
              <div className="page-materials-insert">
                <span>{excerpt.length ? `선택한 부분 · ${excerpt.length}자` : '전체 본문'}</span>
                <button
                  type="button"
                  disabled={disabled || !(excerpt || body).trim()}
                  onPointerDown={captureExcerpt}
                  onClick={() => {
                    const markdown = excerptRef.current || body;
                    if (disabled || !markdown.trim()) return;
                    setInsertError('');
                    setNotice('');
                    try {
                      onInsert(markdown);
                      setNotice('본문 끝에 넣었어요. 원본은 그대로 남아 있어요.');
                    } catch (cause) {
                      setInsertError(
                        cause instanceof Error
                          ? cause.message
                          : '본문에 넣지 못했어요. 다시 시도해 주세요.',
                      );
                    }
                  }}
                >
                  본문 끝에 넣기
                </button>
              </div>
            </>
          )}
          {disabled && (
            <p className="page-materials-lock">문서의 저장·복구 상태를 확인한 뒤 넣을 수 있어요.</p>
          )}
          {insertError && (
            <p className="page-materials-error" role="alert">
              {insertError}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
        </section>
      )}
    </section>
  );
}
