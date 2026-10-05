import { onlineActionFetch } from '../sync/onlineActions';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronUp,
  ChevronDown,
  LocateFixed,
  MessageCircle,
  MoreHorizontal,
  RotateCw,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { publishRecordChange } from '../trash/events';
import { formatKoreanTime } from '../time';
import { getBlockExcerpt, type PreviewThread, type CommentSummary } from './pageComments';
import './pageCommentPreview.css';

export default function PageCommentPreview({
  pageId,
  audience = 'private',
  onAudienceChange,
  blocks,
  selectedBlockId,
  listOpen,
  onSelectBlock,
  onClosePanel,
  onCommentedBlocksChange,
  onLocateBlock,
  onThreadsLoaded,
  onThreadViewed,
  readStatusError,
  onRetryRead,
}: {
  pageId: string;
  audience?: 'private' | 'shared';
  onAudienceChange?: (audience: 'private' | 'shared') => void;
  blocks: unknown[];
  selectedBlockId: string | null;
  listOpen: boolean;
  onSelectBlock: (id: string | null) => void;
  onClosePanel: () => void;
  onCommentedBlocksChange: (items: CommentSummary[]) => void;
  onLocateBlock: (id: string) => void;
  onThreadsLoaded?: (items: PreviewThread[]) => void;
  onThreadViewed?: (thread: PreviewThread) => void;
  readStatusError?: string;
  onRetryRead?: () => void;
}) {
  const [threads, setThreads] = useState<PreviewThread[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const draftScope = audience === 'shared' ? `shared:${pageId}` : pageId;
  const endpoint = `/api/pages/${pageId}/${audience === 'shared' ? 'shared-comments' : 'comments'}`;
  const pendingKey = `leneu:comment-pending:${draftScope}`;
  const pending = useRef<{
    identity: string;
    body: Record<string, unknown>;
    requestId: string;
  } | null>(
    (() => {
      try {
        return JSON.parse(sessionStorage.getItem(pendingKey) || 'null');
      } catch {
        return null;
      }
    })(),
  );
  const selection = useRef(selectedBlockId);
  selection.current = selectedBlockId;
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState('');
  const [resolvedExpanded, setResolvedExpanded] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [viewport, setViewport] = useState({
    height: window.innerHeight,
    bottom: 0,
    keyboard: false,
  });
  const actions = useRef<HTMLDetailsElement>(null);
  const bodyArea = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const reading = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const visual = window.visualViewport;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = visual?.height ?? innerHeight,
          bottom = Math.max(0, innerHeight - height - (visual?.offsetTop ?? 0));
        setViewport({ height, bottom, keyboard: innerHeight - height > 150 });
      });
    };
    visual?.addEventListener('resize', measure);
    visual?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      visual?.removeEventListener('resize', measure);
      visual?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, []);
  const [filter, setFilter] = useState<'open' | 'resolved'>('open');
  const firstField = useRef<HTMLTextAreaElement>(null);
  const thread = threads.find((entry) => entry.blockId === selectedBlockId);
  useEffect(() => {
    if (loaded && thread && !error && !busy) onThreadViewed?.(thread);
  }, [loaded, thread, error, busy, onThreadViewed]);
  const visibleThreads = threads
    .filter((entry) => entry.resolved === (filter === 'resolved'))
    .slice()
    .reverse();

  useEffect(() => {
    if (loaded)
      onCommentedBlocksChange(
        threads.map((entry) => ({
          blockId: entry.blockId,
          count: entry.comments.length,
          resolved: entry.resolved,
        })),
      );
  }, [threads, loaded, onCommentedBlocksChange]);

  useEffect(() => {
    setDraft(sessionStorage.getItem(`leneu:comment:${draftScope}:${selectedBlockId}`) || '');
    setReply(sessionStorage.getItem(`leneu:reply:${draftScope}:${selectedBlockId}`) || '');
    setResolvedExpanded(false);
  }, [pageId, selectedBlockId]);

  useEffect(() => {
    setResolvedExpanded(false);
  }, [selectedBlockId, thread?.resolved]);
  useEffect(() => {
    if (
      selectedBlockId &&
      loaded &&
      !thread?.resolved &&
      window.matchMedia('(min-width:1240px)').matches
    )
      firstField.current?.focus();
  }, [selectedBlockId, loaded, thread?.resolved]);
  useEffect(() => {
    if (thread) bodyArea.current?.scrollTo({ top: bodyArea.current.scrollHeight });
  }, [selectedBlockId, thread?.comments.length]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (actions.current && !actions.current.contains(event.target as Node))
        actions.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (actions.current?.open) {
        actions.current.open = false;
        event.stopPropagation();
        return;
      }
      if (selectedBlockId) onSelectBlock(null);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [selectedBlockId, onSelectBlock]);

  async function load() {
    if (reading.current || sending.current) return;
    reading.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await onlineActionFetch(endpoint);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (!mounted.current) return;
      setThreads(result.items);
      setLoaded(true);
      onThreadsLoaded?.(result.items);
    } catch {
      setError('댓글을 불러오지 못했어요. 다시 불러와 주세요.');
    } finally {
      reading.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, [pageId]);
  async function mutate(body: Record<string, unknown>): Promise<boolean> {
    if (sending.current || reading.current || busy || !loaded) return false;
    sending.current = true;
    const { expectedVersion, ...intent } = body;
    const identity = JSON.stringify(intent);
    if (pending.current?.identity !== identity)
      pending.current = { identity, body, requestId: crypto.randomUUID() };
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify(pending.current));
    } catch {}
    setBusy(true);
    setError('');
    try {
      const response = await onlineActionFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...pending.current.body, requestId: pending.current.requestId }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          pending.current = null;
          sessionStorage.removeItem(pendingKey);
        }
        throw new Error(result.error || '댓글을 저장하지 못했어요.');
      }
      setThreads(result.items);
      if (audience === 'shared') publishRecordChange('shared-comments');
      pending.current = null;
      sessionStorage.removeItem(pendingKey);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '댓글을 저장하지 못했어요. 다시 시도해 주세요.');
      return false;
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function submitComment() {
    const origin = selectedBlockId;
    if (
      origin &&
      draft.trim() &&
      (await mutate({ blockId: origin, text: draft, action: 'create' }))
    ) {
      if (selection.current === origin) setDraft('');
      sessionStorage.removeItem(`leneu:comment:${draftScope}:${origin}`);
    }
  }
  async function submitReply() {
    const origin = selectedBlockId;
    if (
      thread &&
      reply.trim() &&
      (await mutate({
        threadId: thread.id,
        expectedVersion: thread.version,
        text: reply,
        action: 'reply',
      }))
    ) {
      if (selection.current === origin) {
        setReply('');
      }
      sessionStorage.removeItem(`leneu:reply:${draftScope}:${origin}`);
    }
  }
  function quoted(entry: PreviewThread) {
    return entry.orphaned
      ? `삭제되거나 이동한 블록 · ${entry.excerpt}`
      : getBlockExcerpt(blocks, entry.blockId);
  }

  function rememberDraft(text: string) {
    if (thread) setReply(text);
    else setDraft(text);
    try {
      sessionStorage.setItem(
        `leneu:${thread ? 'reply' : 'comment'}:${draftScope}:${selectedBlockId}`,
        text,
      );
    } catch {}
  }
  async function submit() {
    if (thread) await submitReply();
    else await submitComment();
    requestAnimationFrame(() => firstField.current?.focus());
  }
  const messages = thread && (
    <ol className="page-comment-messages">
      {thread.comments.map((comment, index) => (
        <li key={comment.id}>
          <span className="page-comment-avatar" aria-hidden>
            {audience === 'private' || comment.isOwner ? (
              <img src="/profile.png" alt="" />
            ) : (
              <span>{Array.from(comment.name || '방문자')[0]}</span>
            )}
          </span>
          <div>
            <span className="page-comment-author">
              {comment.name || '나'}{' '}
              {audience === 'shared' && comment.isOwner && (
                <b className="page-comment-owner">작성자</b>
              )}
              <span>
                {index === 0 ? '댓글' : '답글'} ·{' '}
                {formatKoreanTime(new Date(comment.createdAt).toISOString())}
              </span>
            </span>
            <p>{comment.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
  return (
    <aside
      className={`page-comment-panel${selectedBlockId ? ' has-selection' : ''}${listOpen ? ' has-list' : ''}${sheetExpanded ? ' is-expanded' : ''}${viewport.keyboard ? ' has-keyboard' : ''}`}
      aria-label="블록 댓글"
      style={
        {
          '--comment-visible-height': `${viewport.height}px`,
          '--comment-keyboard-bottom': `${viewport.bottom}px`,
        } as CSSProperties
      }
    >
      <header className="page-comment-panel-head">
        <div>
          {selectedBlockId ? (
            <button type="button" aria-label="댓글 목록으로" onClick={() => onSelectBlock(null)}>
              <ArrowLeft size={17} />
            </button>
          ) : (
            <MessageCircle className="page-comment-panel-icon" size={17} />
          )}
          <h2>{selectedBlockId ? '블록 대화' : '문서 댓글'}</h2>
          <span className="page-comment-total">
            {thread ? thread.comments.length : threads.length}
          </span>
        </div>
        <div>
          <button
            type="button"
            aria-label="댓글 새로고침"
            title="댓글 새로고침"
            disabled={busy}
            onClick={() => void load()}
          >
            <RotateCw size={16} />
          </button>
          <button
            type="button"
            className="page-comment-sheet-toggle"
            aria-label={sheetExpanded ? '댓글 패널 줄이기' : '댓글 패널 펼치기'}
            aria-expanded={sheetExpanded}
            onClick={() => setSheetExpanded((value) => !value)}
          >
            {sheetExpanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
          <button type="button" aria-label="댓글 패널 닫기" onClick={onClosePanel}>
            <X size={18} />
          </button>
        </div>
      </header>
      {onAudienceChange && (
        <div className="page-comment-audience" role="group" aria-label="댓글 공개 범위">
          <button
            type="button"
            aria-label="개인 댓글"
            aria-pressed={audience === 'private'}
            onClick={() => onAudienceChange('private')}
          >
            개인 댓글
          </button>
          <button
            type="button"
            aria-label="공유 댓글"
            aria-pressed={audience === 'shared'}
            onClick={() => onAudienceChange('shared')}
          >
            공유 댓글
          </button>
        </div>
      )}
      <p className="page-comment-preview-note">
        {audience === 'shared'
          ? '댓글 허용 링크의 방문자와 함께 보는 대화'
          : '개인 댓글 · 나에게만 표시돼요'}
      </p>
      {readStatusError && (
        <div className="page-comment-error" role="alert">
          {readStatusError}{' '}
          {onRetryRead && (
            <button type="button" onClick={onRetryRead}>
              읽음 상태 다시 저장
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="page-comment-error" role="alert">
          {error}{' '}
          <button type="button" disabled={busy} onClick={() => void load()}>
            다시 불러오기
          </button>
        </div>
      )}
      {!loaded && !error && (
        <p className="page-comment-loading" role="status">
          댓글 불러오는 중…
        </p>
      )}
      {busy && (
        <span className="page-comment-saving" role="status">
          {reading.current ? '댓글 불러오는 중…' : '저장 중…'}
        </span>
      )}
      {selectedBlockId && (
        <div className="page-comment-anchor">
          <div>
            <span>{thread?.orphaned ? '이전 블록의 기록' : '댓글을 단 블록'}</span>
            <button
              type="button"
              disabled={thread?.orphaned}
              onClick={() => {
                firstField.current?.blur();
                setSheetExpanded(false);
                onLocateBlock(selectedBlockId);
              }}
            >
              <LocateFixed size={13} />
              본문 위치
            </button>
          </div>
          <p title={thread ? quoted(thread) : getBlockExcerpt(blocks, selectedBlockId)}>
            {thread ? quoted(thread) : getBlockExcerpt(blocks, selectedBlockId)}
          </p>
        </div>
      )}
      <div className="page-comment-panel-body" ref={bodyArea}>
        {!selectedBlockId ? (
          <>
            <div className="page-comment-filters" role="group" aria-label="댓글 상태">
              {(['open', 'resolved'] as const).map((state) => (
                <button
                  type="button"
                  key={state}
                  aria-pressed={filter === state}
                  onClick={() => setFilter(state)}
                >
                  {state === 'open' ? '진행 중' : '해결됨'}{' '}
                  <span>
                    {threads.filter((entry) => entry.resolved === (state === 'resolved')).length}
                  </span>
                </button>
              ))}
            </div>
            {visibleThreads.length ? (
              <ol className="page-comment-thread-list">
                {visibleThreads.map((entry) => (
                  <li key={entry.id}>
                    <button type="button" onClick={() => onSelectBlock(entry.blockId)}>
                      <span className="page-comment-list-anchor">{quoted(entry)}</span>
                      <span className="page-comment-list-message">
                        {entry.comments.at(-1)?.text}
                      </span>
                      <span className="page-comment-list-meta">
                        {entry.comments.at(-1)?.name || '나'} · {entry.comments.length}개 댓글 ·{' '}
                        {formatKoreanTime(new Date(entry.comments.at(-1)!.createdAt).toISOString())}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              loaded && (
                <div className="page-comment-empty">
                  <MessageCircle size={23} strokeWidth={1.6} />
                  <strong>
                    {filter === 'open' ? '아직 진행 중인 댓글이 없어요.' : '해결된 댓글이 없어요.'}
                  </strong>
                  <p>본문 블록 옆 말풍선을 눌러 대화를 시작하세요.</p>
                </div>
              )
            )}
          </>
        ) : thread ? (
          <section className="page-comment-thread" aria-label="선택한 블록의 댓글">
            <div className="page-comment-thread-head">
              <span className={thread.resolved ? 'is-resolved' : 'is-open'}>
                {thread.resolved ? <Check size={14} /> : <MessageCircle size={14} />}{' '}
                {thread.resolved ? '해결됨' : '진행 중'}
              </span>
              <div className="page-comment-thread-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void mutate({
                      threadId: thread.id,
                      expectedVersion: thread.version,
                      action: 'resolve',
                      resolved: !thread.resolved,
                    })
                  }
                >
                  {thread.resolved ? '다시 열기' : '해결'}
                </button>
                <details className="page-comment-actions" ref={actions} key={thread.id}>
                  <summary aria-label="대화 더보기">
                    <MoreHorizontal size={17} />
                  </summary>
                  <div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (actions.current) actions.current.open = false;
                        if (window.confirm('이 대화와 답글을 삭제할까요?'))
                          void mutate({
                            threadId: thread.id,
                            expectedVersion: thread.version,
                            action: 'delete',
                          });
                      }}
                    >
                      <Trash2 size={14} />
                      대화 삭제
                    </button>
                  </div>
                </details>
              </div>
            </div>
            {thread.resolved && (
              <div className="page-comment-resolved">
                <Check size={17} />
                <p>이 대화를 해결했어요.</p>
                <button
                  type="button"
                  aria-expanded={resolvedExpanded}
                  onClick={() => setResolvedExpanded((v) => !v)}
                >
                  {resolvedExpanded ? '댓글 접기' : `댓글 ${thread.comments.length}개 펼치기`}
                </button>
              </div>
            )}
            {(!thread.resolved || resolvedExpanded) && messages}
          </section>
        ) : (
          <p className="page-comment-new-hint">이 블록에 대한 생각이나 확인할 내용을 남겨보세요.</p>
        )}
      </div>
      {selectedBlockId && !thread?.resolved && (
        <footer className="page-comment-compose">
          <label htmlFor="page-comment-draft">
            {thread ? '답글 남기기' : '이 블록에 댓글 남기기'}
          </label>
          <textarea
            id="page-comment-draft"
            ref={firstField}
            aria-label={thread ? '답글 입력' : '댓글 입력'}
            placeholder={thread ? '답글을 적어주세요' : '확인할 내용이나 생각을 남겨주세요'}
            disabled={busy || !loaded}
            value={thread ? reply : draft}
            maxLength={2000}
            rows={2}
            onChange={(event) => rememberDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                (event.metaKey || event.ctrlKey) &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229
              ) {
                event.preventDefault();
                if ((thread ? reply : draft).trim()) void submit();
              }
            }}
            onFocus={() => {
              if (window.matchMedia('(max-width:1239px)').matches) setSheetExpanded(true);
            }}
          />
          <div>
            <span className="page-comment-shortcut">⌘ / Ctrl + Enter로 등록</span>
            <button
              type="button"
              className="page-comment-submit"
              disabled={busy || !loaded || !(thread ? reply : draft).trim()}
              onClick={() => void submit()}
            >
              <Send size={14} />
              {busy ? '등록 중…' : thread ? '답글 등록' : '댓글 남기기'}
            </button>
          </div>
        </footer>
      )}
    </aside>
  );
}
