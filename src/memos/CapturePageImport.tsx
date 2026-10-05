import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, FileText, FolderPlus, Search } from 'lucide-react';
import type { Capture } from './types';
import type { PageRecord, PageSummary } from '../pages/types';
import type { AiJob } from '../ai/types';
import { aiPageMarkdown, suggestedAiPageTitle } from '../ai/pageContent';
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

export default function CapturePageImport({
  capture,
  aiJob,
  expanded,
  onExpand,
  onBack,
  onBusy,
  navigate,
}: Props) {
  const [mode, setMode] = useState<'existing' | 'new'>(aiJob ? 'new' : 'existing');
  const [query, setQuery] = useState('');
  const [pages, setPages] = useState<Destination[]>([]);
  const [linked, setLinked] = useState<Destination[]>([]);
  const [linkedError, setLinkedError] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [target, setTarget] = useState<Destination | null>(null);
  const [title, setTitle] = useState(aiJob ? suggestedAiPageTitle(aiJob) : '');
  const [copyContent, setCopyContent] = useState(!aiJob && Boolean(capture.text || capture.url));
  const [assets, setAssets] = useState(
    () => new Set(aiJob ? [] : capture.files.map((file) => file.id)),
  );
  const [pending, setPending] = useState<Pending | null>(() => recover(capture.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const queued = useQueuedWorkflows(capture.id).find(
    (p) => p.operation.kind === 'capture.organize',
  );
  const [notice, setNotice] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLinkedError(false);
    fetch(`/api/captures/${capture.id}/pages`)
      .then(async (response) => {
        const data = (await response.json()) as { items: Destination[] };
        if (!response.ok || !Array.isArray(data.items)) throw new Error();
        if (active) setLinked(data.items);
      })
      .catch(() => {
        if (active) setLinkedError(true);
      });
    return () => {
      active = false;
    };
  }, [capture.id, retry]);

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
    setCursor(null);
    setLoading(true);
    const timer = setTimeout(() => void loadPages(null, requestGeneration), query ? 180 : 0);
    return () => {
      clearTimeout(timer);
      ++generation.current;
    };
  }, [expanded, query, retry, Boolean(pending)]);
  useEffect(() => {
    if (!expanded) return;
    const focusTarget = pending
      ? panel.current?.querySelector<HTMLButtonElement>('.capture-import-submit:not(:disabled)')
      : search.current;
    (focusTarget || panel.current)?.focus();
  }, [expanded, Boolean(pending), busy]);

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
      const data = (await workflowResult(requestId)) as
        | {
            item?: PageRecord;
            blockIds?: string[];
            error?: string;
          }
        | undefined;
      try {
        sessionStorage.removeItem(keyFor(capture.id));
      } catch {}
      setPending(null);
      if (!data) {
        setNotice('페이지에 정리 대기 · 연결 후 원본과 페이지를 함께 반영해요.');
        return;
      }
      if (!data.item || !Array.isArray(data.blockIds)) throw new Error();
      publishRecordChange('capture-organize');
      navigate(`/pages/${data.item.id}${data.blockIds[0] ? '?import=' + data.blockIds[0] : ''}`);
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
        {linked.length > 0 && (
          <div className="capture-linked-pages">
            <span>담긴 페이지</span>
            {linked.map((item) => (
              <a
                key={item.id}
                href={'/pages/' + item.id}
                title={item.path.map((entry) => entry.title).join(' / ')}
                onClick={(event) => {
                  event.preventDefault();
                  navigate('/pages/' + item.id);
                }}
              >
                <FileText size={14} />
                <span>{item.path.map((entry) => entry.title).join(' / ')}</span>
                <ArrowUpRight size={14} />
              </a>
            ))}
          </div>
        )}
        {linkedError && (
          <button className="capture-link-retry" onClick={() => setRetry((value) => value + 1)}>
            연결된 페이지 다시 불러오기
          </button>
        )}
      </section>
    );

  return (
    <div
      className="capture-import"
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
            'button:not(:disabled), input:not(:disabled), a[href]',
          ) || []),
        ];
        const first = controls[0],
          last = controls.at(-1);
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
        <h2>내 페이지에 정리</h2>
      </header>
      <p className="capture-import-help">
        {aiJob
          ? 'AI 결과와 출처를 편집 가능한 페이지로 담아요. 원본 메모와 결과는 그대로 남아요.'
          : '필요한 내용을 페이지에 담고 원본은 정리 완료로 보관해요.'}
      </p>
      <section className="capture-import-source" aria-label="정리할 메모">
        <span>{aiJob ? '선택한 AI 결과' : '선택한 메모'}</span>
        <p>
          {(aiJob
            ? aiJob.sourceTitle || capture.text
            : capture.text || capture.url || '첨부 메모'
          ).slice(0, 180)}
        </p>
        <small>
          {capture.files.length ? `첨부 ${capture.files.length}개 · ` : ''}필요한 내용만 선택해
          담아요
        </small>
      </section>
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
              <small>선택한 문서 아래에 추가</small>
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
              <small>별도의 문서로 정리</small>
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
          <section
            className="capture-import-destination"
            aria-label={mode === 'existing' ? '담을 페이지' : '상위 페이지'}
          >
            <h3>{mode === 'existing' ? '담을 페이지' : '상위 페이지'}</h3>
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
                  onClick={() => setTarget(null)}
                >
                  <FileText size={16} />
                  <span>
                    <strong>내 페이지에 만들기</strong>
                    <small>상위 페이지 없이 만들어요</small>
                  </span>
                  {!target && <Check size={15} />}
                </button>
              )}
              {pages.map((item) => (
                <button
                  key={item.id}
                  className={
                    'capture-import-result' + (target?.id === item.id ? ' is-selected' : '')
                  }
                  aria-pressed={target?.id === item.id}
                  title={item.path.map((entry) => entry.title).join(' / ')}
                  onClick={() => setTarget(item)}
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
              {cursor && !loadError && (
                <button
                  className="capture-import-more"
                  disabled={loading}
                  onClick={() => void loadPages(cursor)}
                >
                  페이지 더 보기
                </button>
              )}
            </div>
          </section>
          <section className="capture-import-options" aria-label="담을 내용">
            <h3>담을 내용</h3>
            {aiJob && (
              <p>
                <Check size={14} /> 선택한 AI 결과·출처를 문서 본문으로 담아요
              </p>
            )}
            <p>
              <Check size={14} />
              원본 메모는 페이지 정보에서 확인할 수 있어요
            </p>
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
        <section className="capture-import-outcome" aria-label="정리 결과 안내">
          <strong>정리 후 원본</strong>
          <p>
            메모 목록에서는 빠지고, ‘정리 완료’에서 다시 찾을 수 있어요. 원문과 첨부는 보존돼요.
          </p>
          {!pending && (
            <p className="capture-import-receipt">
              {mode === 'existing'
                ? target
                  ? `추가 위치: ${target.path.map((entry) => entry.title).join(' / ')}`
                  : '담을 기존 페이지를 선택해 주세요.'
                : `새 문서: ${title.trim() || '제목 없음'}${target ? ` · ${target.title} 아래` : ' · 내 페이지'}`}
              {' · '}
              {aiJob ? 'AI 결과·출처' : copyContent ? '메모 내용' : '원본 연결'}
              {assets.size ? ` · 첨부 ${assets.size}개` : ''}
            </p>
          )}
        </section>
      )}
      {!queued && (
        <footer className="capture-import-footer">
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
