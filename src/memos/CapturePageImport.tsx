import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, FileText, FolderPlus, Search } from 'lucide-react';
import type { Capture } from './types';
import type { PageRecord, PageSummary } from '../pages/types';
import type { AiJob } from '../ai/types';
import { aiPageMarkdown, suggestedAiPageTitle } from '../ai/pageContent';
import { renderReadMarkdown } from '../ai/markdownReading';
import { publishRecordChange } from '../trash/events';
import './capturePageImport.css';
import { queueWorkflow, workflowResult, useQueuedWorkflows } from '../sync/workflows';
import { listLocalEntities } from '../sync/runtime';

type Destination = PageSummary & { path: { id: string; title: string }[] };
type Pending = { path: string; body: Record<string, unknown>; label: string };
type Props = {
  capture: Capture;
  aiJob?: AiJob | null;
  expanded: boolean;
  onExpand: () => void;
  onBack: () => void;
  onBusy: (value: boolean) => void;
  navigate: (path: string) => void;
};
const keyFor = (id: string) => 'leneu:capture-import:' + id;
function recover(id: string): Pending | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(keyFor(id)) || 'null') as Pending | null;
    return value && typeof value.path === 'string' && value.body && typeof value.label === 'string'
      ? value
      : null;
  } catch {
    return null;
  }
}

type ImportDraft = {
  mode: 'existing' | 'new';
  query: string;
  target: Destination | null;
  title: string;
  copyContent: boolean;
  assetIds: string[];
};
function readDraft(key: string, capture: Capture, aiJob?: AiJob | null): ImportDraft {
  const initial: ImportDraft = {
    mode: aiJob ? 'new' : 'existing',
    query: '',
    target: null,
    title: aiJob ? suggestedAiPageTitle(aiJob) : '',
    copyContent: !aiJob && Boolean(capture.text || capture.url),
    assetIds: aiJob ? [] : capture.files.map((file) => file.id),
  };
  try {
    const draft = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (
      !draft ||
      !['existing', 'new'].includes(draft.mode) ||
      typeof draft.query !== 'string' ||
      typeof draft.title !== 'string' ||
      typeof draft.copyContent !== 'boolean' ||
      !Array.isArray(draft.assetIds) ||
      !draft.assetIds.every((id: unknown) => typeof id === 'string')
    )
      return initial;
    if (
      draft.target &&
      (typeof draft.target.id !== 'string' ||
        typeof draft.target.title !== 'string' ||
        !Number.isInteger(draft.target.version) ||
        !Array.isArray(draft.target.path) ||
        !draft.target.path.every(
          (entry: { id?: unknown; title?: unknown }) =>
            entry && typeof entry.id === 'string' && typeof entry.title === 'string',
        ))
    )
      return initial;
    return {
      ...draft,
      assetIds: draft.assetIds.filter((id: string) => capture.files.some((file) => file.id === id)),
    };
  } catch {
    return initial;
  }
}

export default function CapturePageImport({
  capture,
  aiJob,
  expanded,
  onExpand,
  onBack,
  onBusy,
  navigate,
}: Props) {
  const draftKey = `leneu:capture-import-draft:v1:${capture.id}:${aiJob?.id || 'memo'}`;
  const [initial] = useState(() => readDraft(draftKey, capture, aiJob));
  const [mode, setMode] = useState(initial.mode);
  const [query, setQuery] = useState(initial.query);
  const [pages, setPages] = useState<Destination[]>([]);
  const [visiblePages, setVisiblePages] = useState(5);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [target, setTarget] = useState<Destination | null>(initial.target);
  const [title, setTitle] = useState(initial.title);
  const [copyContent, setCopyContent] = useState(initial.copyContent);
  const [assets, setAssets] = useState(() => new Set(initial.assetIds));
  const [pending, setPending] = useState<Pending | null>(() => recover(capture.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const queued = useQueuedWorkflows(capture.id).find(
    (p) => p.operation.kind === 'capture.organize',
  );
  const [notice, setNotice] = useState('');
  const [awaitingOperation, setAwaitingOperation] = useState<string | null>(null);
  const openedOperation = useRef<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const preview = useMemo(
    () => (aiJob?.result ? renderReadMarkdown(aiPageMarkdown(aiJob)) : null),
    [aiJob],
  );

  const draftSubmitted = useRef(false);
  useEffect(() => {
    if (!expanded || draftSubmitted.current) return;
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ mode, query, target, title, copyContent, assetIds: [...assets] }),
      );
    } catch {
      /* The editable form still works when browser draft storage is unavailable. */
    }
  }, [expanded, draftKey, mode, query, target, title, copyContent, assets]);

  async function loadPages(nextCursor: string | null, requestGeneration = generation.current) {
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ q: query.trim() });
      if (nextCursor) params.set('cursor', nextCursor);
      let data: { items: Destination[]; nextCursor: string | null };
      try {
        const response = await fetch('/api/pages/search?' + params);
        if (!response.ok) throw Error();
        data = await response.json();
      } catch {
        const rows = await listLocalEntities('page', 10000);
        const items = rows.map((e) => e.current as unknown as PageSummary);
        data = {
          items: items
            .filter((p) => p.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
            .slice(0, 50)
            .map((p) => ({ ...p, path: [{ id: p.id, title: p.title }] })),
          nextCursor: null,
        };
      }
      if (!Array.isArray(data.items)) throw new Error();
      if (generation.current !== requestGeneration) return;
      setPages((current) =>
        nextCursor
          ? [...current, ...data.items.filter((item) => !current.some((old) => old.id === item.id))]
          : data.items,
      );
      setCursor(data.nextCursor);
    } catch {
      if (generation.current === requestGeneration)
        setLoadError('페이지를 불러오지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (generation.current === requestGeneration) setLoading(false);
    }
  }

  useEffect(() => {
    if (!expanded || pending) return;
    const requestGeneration = ++generation.current;
    setPages([]);
    setVisiblePages(5);
    setCursor(null);
    setLoading(true);
    const timer = setTimeout(() => void loadPages(null, requestGeneration), query ? 180 : 0);
    return () => {
      clearTimeout(timer);
      ++generation.current;
    };
  }, [expanded, query, Boolean(pending)]);
  useEffect(() => {
    if (!expanded) return;
    const focusTarget = pending
      ? panel.current?.querySelector<HTMLButtonElement>('.capture-import-submit:not(:disabled)')
      : search.current;
    (focusTarget || panel.current)?.focus();
  }, [expanded, Boolean(pending), busy]);

  function openResult(operationId: string, result: { item: unknown; blockIds?: string[] }) {
    if (openedOperation.current === operationId) return;
    openedOperation.current = operationId;
    const item = result.item as PageRecord;
    publishRecordChange('capture-organize');
    navigate(
      '/pages/' +
        item.id +
        (result.blockIds?.[0] ? '?import=' + encodeURIComponent(result.blockIds[0]) : ''),
    );
  }
  useEffect(() => {
    if (!expanded) return;
    if (queued) {
      setAwaitingOperation(queued.operation.operationId);
      return;
    }
    if (!awaitingOperation) return;
    let active = true;
    void workflowResult(awaitingOperation)
      .then((result) => {
        if (active && result?.item) openResult(awaitingOperation, result);
      })
      .catch(() => {
        /* The durable queue retains unknown outcomes for retry. */
      });
    return () => {
      active = false;
    };
  }, [expanded, queued?.operation.operationId, queued?.state, awaitingOperation]);

  async function submit() {
    if (queued || busyRef.current || (!pending && mode === 'existing' && !target)) return;
    busyRef.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    let aiResult;
    if (!pending && aiJob) {
      try {
        const { parsePageMarkdown } = await import('../pages/parseMarkdown');
        aiResult = {
          jobId: aiJob.id,
          document: parsePageMarkdown(
            aiPageMarkdown(aiJob, mode === 'new' ? title.trim() : undefined),
          ),
        };
      } catch {
        setError('결과를 페이지로 변환하지 못했어요. 다시 시도하거나 Markdown을 복사해 주세요.');
        busyRef.current = false;
        setBusy(false);
        onBusy(false);
        return;
      }
    }
    const request: Pending = pending || {
      path: mode === 'existing' ? `/api/pages/${target!.id}/capture-imports` : '/api/pages',
      body:
        mode === 'existing'
          ? {
              operationId: crypto.randomUUID(),
              captureId: capture.id,
              disposition: 'organize',
              copyContent,
              assetIds: [...assets],
              ...(aiResult ? { aiResult } : {}),
            }
          : {
              title: title.trim() || '제목 없음',
              parentId: target?.id ?? null,
              captureImport: {
                operationId: crypto.randomUUID(),
                captureId: capture.id,
                disposition: 'organize',
                copyContent,
                assetIds: [...assets],
                ...(aiResult ? { aiResult } : {}),
              },
            },
      label:
        mode === 'existing'
          ? target!.path.map((entry) => entry.title).join(' / ')
          : `${target ? target.path.map((entry) => entry.title).join(' / ') + ' / ' : ''}${title.trim() || '제목 없음'}`,
    };
    setPending(request);
    try {
      sessionStorage.setItem(keyFor(capture.id), JSON.stringify(request));
    } catch {
      setPending(null);
      setError('제출 정보를 보관하지 못했어요. 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요.');
      busyRef.current = false;
      setBusy(false);
      onBusy(false);
      return;
    }
    try {
      const body = (request.body.captureImport ?? request.body) as Record<string, unknown>;
      const requestId = String(body.operationId);
      await queueWorkflow('capture.organize', 'capture', capture.id, requestId, {
        copyContent: body.copyContent,
        assetIds: body.assetIds,
        aiResult: body.aiResult,
        target:
          request.path === '/api/pages'
            ? {
                newPageId: crypto.randomUUID(),
                title: request.body.title,
                parentId: request.body.parentId,
              }
            : { pageId: request.path.split('/')[3], expectedVersion: target?.version },
      });
      setAwaitingOperation(requestId);
      const data = (await workflowResult(requestId)) as
        | {
            item?: PageRecord;
            blockIds?: string[];
            error?: string;
          }
        | undefined;
      try {
        sessionStorage.removeItem(keyFor(capture.id));
        draftSubmitted.current = true;
        sessionStorage.removeItem(draftKey);
      } catch {}
      setPending(null);
      if (!data) {
        setNotice('페이지에 정리 대기 · 연결 후 원본과 페이지를 함께 반영해요.');
        return;
      }
      if (!data.item || !Array.isArray(data.blockIds)) throw new Error();
      openResult(requestId, { item: data.item, blockIds: data.blockIds });
    } catch {
      setError('저장 여부를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.');
    } finally {
      busyRef.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  if (!expanded)
    return (
      <section className="capture-page-actions" aria-label="페이지 정리">
        <button className="capture-organize" type="button" onClick={onExpand} disabled={!!queued}>
          <FolderPlus size={17} />내 페이지에 정리
          <ArrowUpRight size={16} />
        </button>
        {queued && <p role="status">페이지에 정리 대기 · 원본은 서버 반영 전까지 남아 있어요.</p>}
      </section>
    );

  return (
    <div
      className="capture-page-import"
      ref={panel}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busyRef.current) {
          event.stopPropagation();
          onBack();
        }
        if (event.key !== 'Tab') return;
        const controls = [
          ...(panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), summary, a[href]',
          ) || []),
        ];
        const visibleControls = controls.filter((control) => control.getClientRects().length > 0);
        const first = visibleControls[0],
          last = visibleControls.at(-1);
        if (!first) {
          event.preventDefault();
          panel.current?.focus();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <header className="capture-import-heading">
        <button aria-label="메모로 돌아가기" onClick={onBack} disabled={busy}>
          <ArrowLeft size={19} />
        </button>
        <h2>{aiJob ? '결과를 페이지로 정리' : '내 페이지에 정리'}</h2>
      </header>
      <p className="capture-import-help">
        {aiJob
          ? 'AI 결과와 출처를 편집 가능한 페이지로 담아요. 원본 메모와 결과는 그대로 남아요.'
          : '필요한 내용을 페이지에 담고 원본은 정리 완료로 보관해요.'}
      </p>
      <details className="capture-import-preview">
        <summary>
          <span>{aiJob ? 'AI 결과 전체' : '메모 내용'} · 본문 미리보기</span>
          <small>
            {aiJob?.result?.sources.length
              ? `출처 ${aiJob.result.sources.length}개 포함`
              : '원본 보존'}
          </small>
        </summary>
        {preview ? (
          <article className="ai-result-reading">{preview}</article>
        ) : (
          <p className="capture-import-original">{capture.text || capture.url || '첨부 메모'}</p>
        )}
      </details>
      {notice && <p role="status">{notice}</p>}
      {queued ? (
        <section className="capture-import-pending" role="status">
          <h3>
            {queued.state === 'conflict' || queued.state === 'failed'
              ? '정리 요청 확인이 필요해요'
              : '정리 요청을 기기에 저장했어요'}
          </h3>
          <p>
            {queued.state === 'conflict' || queued.state === 'failed'
              ? '동기화 상태에서 요청을 확인해 주세요. 서버 반영 전까지 원본은 입력함에 남아 있어요.'
              : '연결 후 선택한 페이지와 원본 메모를 함께 반영해요. 서버 반영 전까지 원본은 입력함에 남아 있어요.'}
          </p>
          {queued.error && <p>{queued.error}</p>}
          <p>이 요청의 대상과 선택은 유지돼요. 동기화 상태에서 진행 상황을 확인할 수 있어요.</p>
          <button className="capture-import-return" type="button" onClick={onBack}>
            메모로 돌아가기
          </button>
        </section>
      ) : pending ? (
        <section className="capture-import-pending" role="status">
          <h3>제출한 요청 확인</h3>
          <p>{pending.label}</p>
          <p>대상과 선택은 제출 당시 그대로 유지돼요. 다시 확인해도 중복으로 담기지 않아요.</p>
        </section>
      ) : (
        <div className="capture-import-form" inert={busy}>
          <div className="capture-import-modes" aria-label="담을 위치">
            <button
              aria-label="기존 페이지"
              aria-pressed={mode === 'existing'}
              onClick={() => {
                setMode('existing');
                setError('');
              }}
            >
              <strong>기존 페이지</strong>
            </button>
            <button
              aria-label="새 페이지"
              aria-pressed={mode === 'new'}
              onClick={() => {
                setMode('new');
                setError('');
              }}
            >
              <strong>새 페이지</strong>
            </button>
          </div>
          {mode === 'new' && (
            <label className="capture-import-title">
              새 페이지 제목
              <input
                aria-label="새 페이지 제목"
                value={title}
                maxLength={160}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="제목 없음"
              />
            </label>
          )}
          <details
            open={!target}
            key={mode}
            className="capture-import-destination"
            aria-label={mode === 'existing' ? '담을 페이지' : '상위 페이지'}
          >
            <summary>
              <span>{mode === 'existing' ? '추가할 페이지' : '상위 페이지'}</span>
              <strong>{target?.title || (mode === 'new' ? '내 페이지' : '선택해 주세요')}</strong>
            </summary>
            {target && (
              <p className="capture-import-selected">
                <Check size={14} />
                <span>{target.path.map((entry) => entry.title).join(' / ')}</span>
              </p>
            )}
            <label className="capture-import-search">
              <Search size={16} />
              <input
                ref={search}
                aria-label="정리할 페이지 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                maxLength={160}
                placeholder="페이지 제목으로 찾기"
              />
            </label>
            <div className="capture-import-results">
              {mode === 'new' && (
                <button
                  className={'capture-import-result' + (!target ? ' is-selected' : '')}
                  aria-pressed={!target}
                  onClick={(event) => {
                    setTarget(null);
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                >
                  <FileText size={16} />
                  <span>
                    <strong>내 페이지에 만들기</strong>
                    <small>상위 페이지 없이 만들어요</small>
                  </span>
                  {!target && <Check size={15} />}
                </button>
              )}
              {pages.slice(0, visiblePages).map((item) => (
                <button
                  key={item.id}
                  className={
                    'capture-import-result' + (target?.id === item.id ? ' is-selected' : '')
                  }
                  aria-pressed={target?.id === item.id}
                  title={item.path.map((entry) => entry.title).join(' / ')}
                  onClick={(event) => {
                    setTarget(item);
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                >
                  <span aria-hidden>{item.icon || <FileText size={16} />}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.path.length > 1
                        ? item.path
                            .slice(0, -1)
                            .map((entry) => entry.title)
                            .join(' / ')
                        : '내 페이지'}
                    </small>
                  </span>
                  {target?.id === item.id && <Check size={15} />}
                </button>
              ))}
              {loading && <p role="status">페이지를 불러오는 중…</p>}
              {!loading && !loadError && !pages.length && (
                <p>{query ? '일치하는 페이지가 없어요.' : '새 페이지를 만들어 정리해 보세요.'}</p>
              )}
              {loadError && (
                <div className="capture-import-error" role="alert">
                  <span>{loadError}</span>
                  <button onClick={() => void loadPages(cursor)}>다시 불러오기</button>
                </div>
              )}
              {(cursor || visiblePages < pages.length) && !loadError && (
                <button
                  className="capture-import-more"
                  disabled={loading}
                  onClick={() => {
                    setVisiblePages((count) => count + 5);
                    if (visiblePages >= pages.length && cursor) void loadPages(cursor);
                  }}
                >
                  페이지 더 보기
                </button>
              )}
            </div>
          </details>
          <section className="capture-import-options" aria-label="담을 내용">
            <h3>담을 내용</h3>
            {aiJob && (
              <p>
                <Check size={14} /> 선택한 AI 결과·출처를 문서 본문으로 담아요
              </p>
            )}

            <label>
              <input
                type="checkbox"
                checked={copyContent}
                disabled={!capture.text && !capture.url}
                onChange={(event) => setCopyContent(event.target.checked)}
              />
              <span>
                {aiJob ? '원본 메모 내용도 복사' : '내용 복사'}
                <small>페이지에서 고쳐도 메모는 그대로예요</small>
              </span>
            </label>
            {capture.files.map((file) => (
              <label key={file.id}>
                <input
                  type="checkbox"
                  aria-label={file.name}
                  checked={assets.has(file.id)}
                  onChange={(event) =>
                    setAssets((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(file.id);
                      else next.delete(file.id);
                      return next;
                    })
                  }
                />
                <span title={file.name}>{file.name}</span>
              </label>
            ))}
          </section>
        </div>
      )}
      {!queued && (
        <footer className="capture-import-footer">
          <p>원문과 결과는 그대로 보관하고, 메모는 ‘정리 완료’로 옮겨요.</p>
          {error && (
            <p className="capture-import-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="capture-import-submit"
            disabled={busy || (!pending && mode === 'existing' && !target)}
            onClick={() => void submit()}
          >
            {busy
              ? '페이지에 담는 중…'
              : pending
                ? '같은 요청 다시 확인'
                : mode === 'new'
                  ? '새 페이지로 정리'
                  : '선택한 페이지에 추가'}
            <ArrowUpRight size={17} />
          </button>
        </footer>
      )}
    </div>
  );
}
