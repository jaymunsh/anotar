import {onlineActionFetch} from '../sync/onlineActions';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, FileText, FolderPlus, Search, X } from 'lucide-react';
import type { Capture } from './types';
import type { PageRecord, PageSummary } from '../pages/types';
import { publishRecordChange } from '../trash/events';
import './captureBatch.css';

import { captureBatchStorageKey as storageKey } from './captureBatchState';
type Destination = PageSummary & { path: { id: string; title: string }[] };
type Choice = { capture: Capture; copyContent: boolean; assetIds: Set<string> };
type Pending = {
  schemaVersion: 1;
  body: Record<string, unknown>;
  destination: string;
  count: number;
};
function recover(): { pending: Pending | null; error: string } {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return { pending: null, error: '' };
    const value = JSON.parse(raw);
    if (
      value?.schemaVersion !== 1 ||
      !value.body?.operationId ||
      !Array.isArray(value.body.items) ||
      !value.body.items.length ||
      value.body.items.length > 20 ||
      typeof value.destination !== 'string'
    )
      throw new Error();
    return { pending: value, error: '' };
  } catch {
    return {
      pending: null,
      error: '보관한 요청 사본을 읽지 못했어요. 기존 메모는 그대로 보관돼 있어요.',
    };
  }
}

export default function CaptureBatchImport({
  captures,
  onClose,
  onDone,
}: {
  captures: Capture[];
  onClose: () => void;
  onDone: (page: PageRecord, blockIds: string[]) => void;
}) {
  const [recovery] = useState(recover);
  const [pending, setPending] = useState(recovery.pending);
  const [choices, setChoices] = useState<Choice[]>(() =>
    captures.map((capture) => ({
      capture,
      copyContent: Boolean(capture.text || capture.url),
      assetIds: new Set(capture.files.map((file) => file.id)),
    })),
  );
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState<Destination | null>(null);
  const [pages, setPages] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState(recovery.error);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (firstInput.current || panel.current)?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (pending) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    setPages([]);
    const timer = setTimeout(
      async () => {
        try {
          const response = await fetch(
            '/api/pages/search?' + new URLSearchParams({ q: query.trim() }),
            { signal: controller.signal },
          );
          const data = await response.json();
          if (!response.ok || !Array.isArray(data.items)) throw new Error();
          if (!controller.signal.aborted) setPages(data.items);
        } catch {
          if (!controller.signal.aborted)
            setLoadError('페이지를 불러오지 못했어요. 다시 시도해 주세요.');
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      },
      query ? 180 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, retry, Boolean(pending)]);

  function editChoice(id: string, change: (choice: Choice) => Choice) {
    if (busy || pending) return;
    setChoices((current) =>
      current.map((choice) => (choice.capture.id === id ? change(choice) : choice)),
    );
  }
  async function submit() {
    if (submitting.current) return;
    if (
      !pending &&
      (!choices.length ||
        choices.some((choice) => !choice.copyContent && !choice.assetIds.size) ||
        (mode === 'existing' && !target))
    )
      return;
    const request: Pending = pending || {
      schemaVersion: 1,
      count: choices.length,
      destination:
        mode === 'existing'
          ? target!.path.map((p) => p.title).join(' / ')
          : title.trim() || '제목 없음',
      body: {
        operationId: crypto.randomUUID(),
        ...(mode === 'existing'
          ? { pageId: target!.id, expectedPageVersion: target!.version }
          : { title: title.trim() || '제목 없음', parentId: target?.id ?? null }),
        items: choices.map(({ capture, copyContent, assetIds }) => ({
          captureId: capture.id,
          expectedVersion: capture.version,
          operationId: crypto.randomUUID(),
          copyContent,
          assetIds: [...assetIds],
        })),
      },
    };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(request));
    } catch {
      setError('요청 사본을 보관하지 못했어요. 브라우저 저장 공간을 확인해 주세요.');
      return;
    }
    setPending(request);
    setBusy(true);
    setError('');
    submitting.current = true;
    try {
      const response = await onlineActionFetch('/api/capture-batches/organize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      });
      const result = await response.json();
      if (!response.ok) {
        if ([400, 404, 409].includes(response.status)) {
          try {
            sessionStorage.removeItem(storageKey);
          } catch {}
          setPending(null);
          setError(result.error || '메모와 대상 페이지를 다시 확인해 주세요.');
          return;
        }
        throw new Error();
      }
      if (!result.item?.id || !Array.isArray(result.blockIds)) throw new Error();
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
      publishRecordChange('capture-batch-organize');
      onDone(result.item, result.blockIds);
    } catch {
      setError('정리 여부를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const valid =
    !!pending ||
    (!!choices.length &&
      choices.every((choice) => choice.copyContent || choice.assetIds.size) &&
      (mode === 'new' || !!target));
  return createPortal(
    <div
      className="capture-batch-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) close.current();
      }}
    >
      <section
        className="capture-batch"
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-batch-title"
        ref={panel}
        tabIndex={-1}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            event.stopPropagation();
          }
          if (event.key === 'Escape' && !event.nativeEvent.isComposing && !busy) {
            event.stopPropagation();
            close.current();
          }
          if (event.key === 'Tab') {
            const controls = [
              ...(panel.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),a[href]',
              ) || []),
            ];
            const first = controls[0],
              last = controls.at(-1);
            if (!first) {
              event.preventDefault();
              panel.current?.focus();
            } else if (
              event.shiftKey &&
              (document.activeElement === first || document.activeElement === panel.current)
            ) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <header>
          <div>
            <FolderPlus size={18} />
            <h2 id="capture-batch-title">메모 함께 정리</h2>
          </div>
          <button type="button" aria-label="함께 정리 닫기" disabled={busy} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="capture-batch-body">
          <p className="capture-batch-hint">
            선택한 내용과 첨부를 한 페이지에 담아요. 원본은 정리 완료에 보관돼요.
          </p>
          {pending ? (
            <div className="capture-batch-pending">
              <strong>{pending.destination}</strong>
              <p>
                {pending.count}개 메모의 요청 사본을 보관하고 있어요. 다시 확인해도 중복해서 담지
                않아요.
              </p>
            </div>
          ) : (
            <>
              <div className="capture-batch-modes" role="group" aria-label="정리 대상 방식">
                <button
                  type="button"
                  aria-pressed={mode === 'existing'}
                  onClick={() => {
                    setMode('existing');
                    setTarget(null);
                  }}
                >
                  기존 페이지
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'new'}
                  onClick={() => {
                    setMode('new');
                    setTarget(null);
                  }}
                >
                  새 페이지
                </button>
              </div>
              {mode === 'new' && (
                <label className="capture-batch-title-input">
                  새 페이지 제목
                  <input
                    value={title}
                    maxLength={160}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="페이지 제목"
                  />
                </label>
              )}
              <label className="capture-batch-search">
                <Search size={16} />
                <input
                  ref={firstInput}
                  aria-label={mode === 'new' ? '상위 페이지 검색' : '정리할 페이지 검색'}
                  value={query}
                  maxLength={160}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={mode === 'new' ? '상위 페이지 검색 · 선택 사항' : '대상 페이지 검색'}
                />
              </label>
              {target && (
                <p className="capture-batch-target">
                  선택한 위치 · {target.path.map((p) => p.title).join(' / ')}
                </p>
              )}
              <div className="capture-batch-destinations">
                {mode === 'new' && (
                  <button type="button" aria-pressed={!target} onClick={() => setTarget(null)}>
                    최상위에 만들기
                  </button>
                )}
                {pages.map((page) => (
                  <button
                    type="button"
                    key={page.id}
                    aria-pressed={target?.id === page.id}
                    onClick={() => setTarget(page)}
                  >
                    <FileText size={15} />
                    <span>{page.path.map((p) => p.title).join(' / ')}</span>
                  </button>
                ))}
                {loading && <p role="status">페이지를 불러오는 중…</p>}
                {loadError && (
                  <p role="alert">
                    {loadError}{' '}
                    <button type="button" onClick={() => setRetry((n) => n + 1)}>
                      다시 불러오기
                    </button>
                  </p>
                )}
                {!loading && !loadError && !pages.length && (
                  <p>찾는 페이지가 없어요. 다른 단어로 검색하거나 새 페이지를 만들 수 있어요.</p>
                )}
              </div>
              <h3>담을 내용 · {choices.length}개 메모</h3>
              <ul className="capture-batch-choices">
                {choices.map((choice) => (
                  <li key={choice.capture.id}>
                    <p>
                      {choice.capture.text ||
                        choice.capture.url ||
                        choice.capture.files.map((f) => f.name).join(', ')}
                    </p>
                    {!!(choice.capture.text || choice.capture.url) && (
                      <label>
                        <input
                          type="checkbox"
                          checked={choice.copyContent}
                          onChange={(event) =>
                            editChoice(choice.capture.id, (c) => ({
                              ...c,
                              copyContent: event.target.checked,
                            }))
                          }
                        />
                        원문과 링크
                      </label>
                    )}
                    {choice.capture.files.map((file) => (
                      <label key={file.id}>
                        <input
                          type="checkbox"
                          checked={choice.assetIds.has(file.id)}
                          onChange={(event) =>
                            editChoice(choice.capture.id, (c) => {
                              const assetIds = new Set(c.assetIds);
                              event.target.checked
                                ? assetIds.add(file.id)
                                : assetIds.delete(file.id);
                              return { ...c, assetIds };
                            })
                          }
                        />
                        <span>{file.name}</span>
                      </label>
                    ))}
                  </li>
                ))}
              </ul>
            </>
          )}
          {error && (
            <p className="capture-batch-error" role="alert">
              {error}
            </p>
          )}
          {recovery.error && !pending && (
            <button
              type="button"
              onClick={() => {
                if (
                  !window.confirm(
                    '읽지 못한 요청 사본을 지울까요? 메모와 페이지 원본은 삭제하지 않아요.',
                  )
                )
                  return;
                try {
                  sessionStorage.removeItem(storageKey);
                  onClose();
                } catch {
                  setError('요청 사본을 지우지 못했어요. 브라우저 저장 공간을 확인해 주세요.');
                }
              }}
            >
              읽지 못한 요청 사본 지우기
            </button>
          )}
          {!pending && !choices.length && <p>메모 목록에서 정리할 항목을 선택해 주세요.</p>}
        </div>
        <footer>
          <span>
            {pending ? '요청 내용은 다시 확인할 때까지 유지돼요' : '원본과 첨부는 그대로 보관해요'}
          </span>
          <button
            type="button"
            className="capture-batch-submit"
            disabled={busy || !valid}
            onClick={() => void submit()}
          >
            {busy
              ? '정리 확인 중…'
              : pending
                ? '같은 요청 다시 확인'
                : `${choices.length}개 메모 정리`}
            <ArrowRight size={16} />
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
