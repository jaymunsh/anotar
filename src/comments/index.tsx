import { WorkspaceToolbar } from '../workspace/WorkspaceToolbar';
import { useEffect, useState, type MouseEvent } from 'react';
import { ArrowRight, ArrowUpRight, Check, MessageCircle, RefreshCw } from 'lucide-react';
import { formatKoreanTime } from '../time';
import { commentThreadHref, type CommentInboxItem, type CommentInboxView } from './types';
import { useCommentInbox } from './useCommentInbox';
import './comments.css';
const filters = [
  { view: 'unread', label: '미확인' },
  { view: 'open', label: '미해결' },
  { view: 'resolved', label: '해결됨' },
  { view: 'all', label: '전체' },
] as const;
function initialView(): CommentInboxView {
  const value = new URLSearchParams(location.search).get('view');
  return value === 'all' || value === 'open' || value === 'resolved' ? value : 'unread';
}
function follow(
  event: MouseEvent<HTMLAnchorElement>,
  href: string,
  navigate: (href: string) => void,
) {
  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(href);
}
function ThreadRow({
  item,
  onNavigate,
}: {
  item: CommentInboxItem;
  onNavigate: (href: string) => void;
}) {
  const href = commentThreadHref(item);
  return (
    <li>
      <a
        href={href}
        className={item.unread ? 'is-unread' : ''}
        onClick={(event) => follow(event, href, onNavigate)}
      >
        <span className="comments-avatar" aria-hidden>
          {item.isOwner ? <img src="/profile.png" alt="" /> : Array.from(item.name)[0]}
        </span>
        <div className="comments-row-copy">
          <div className="comments-row-top">
            <span className="comments-page">
              {item.pageIcon && <span aria-hidden>{item.pageIcon} </span>}
              {item.pageTitle}
            </span>
            {item.unread && <span className="comments-unread">미확인</span>}
            <span className={`comments-state ${item.resolved ? 'is-resolved' : ''}`}>
              {item.resolved ? <Check size={12} /> : <MessageCircle size={12} />}{' '}
              {item.resolved ? '해결됨' : '미해결'}
            </span>
          </div>
          <p className="comments-message">{item.text || '대화 내용 없음'}</p>
          <div className="comments-row-meta">
            <span>
              {item.name}
              {item.isOwner ? ' · 작성자' : ''}
            </span>
            <time dateTime={new Date(item.createdAt).toISOString()}>
              {formatKoreanTime(new Date(item.createdAt).toISOString())}
            </time>
          </div>
          <p className="comments-excerpt">{item.excerpt}</p>
        </div>
        <ArrowUpRight className="comments-row-arrow" size={16} />
      </a>
    </li>
  );
}
function InboxSurface({
  compact = false,
  onNavigate,
}: {
  compact?: boolean;
  onNavigate: (href: string) => void;
}) {
  const requestedView = initialView();
  const [view, setView] = useState<CommentInboxView>(compact ? 'all' : requestedView);
  useEffect(() => {
    if (!compact) setView(requestedView);
  }, [requestedView, compact]);
  const { surface, data, error, checkedAt, loading, moreBusy, loadMore, retry } = useCommentInbox(
    view,
    compact,
  );
  return (
    <section
      ref={surface}
      className={`comments-inbox${compact ? ' comments-attention' : ''}`}
      aria-label={compact ? '공유 댓글 현황' : '공유 댓글 받은함'}
    >
      {compact ? (
        <header className="comments-heading">
          <h2>
            <MessageCircle size={17} /> 공유 댓글
          </h2>
          <a href="/comments" onClick={(event) => follow(event, '/comments', onNavigate)}>
            모두 보기 <ArrowRight size={15} />
          </a>
        </header>
      ) : (
        <WorkspaceToolbar title="공유 댓글" meta={`미확인 ${data?.counts.unread ?? '—'}`}>
          <button
            type="button"
            onClick={retry}
            disabled={loading}
            className="toolbar-icon-mobile"
            aria-label="댓글 새로고침"
            title="댓글 새로고침"
          >
            <RefreshCw size={16} />
            <span>새로고침</span>
          </button>
        </WorkspaceToolbar>
      )}
      {compact ? (
        <div className="comments-counters">
          <a
            href="/comments?view=unread"
            onClick={(event) => follow(event, '/comments?view=unread', onNavigate)}
          >
            미확인 <b>{data?.counts.unread ?? '—'}</b>
          </a>
          <a
            href="/comments?view=open"
            onClick={(event) => follow(event, '/comments?view=open', onNavigate)}
          >
            미해결 <b>{data?.counts.open ?? '—'}</b>
          </a>
        </div>
      ) : (
        <div className="comments-filters" role="group" aria-label="공유 댓글 필터">
          {filters.map((item) => (
            <button
              key={item.view}
              type="button"
              aria-pressed={view === item.view}
              onClick={() => {
                setView(item.view);
                history.replaceState(null, '', `/comments?view=${item.view}`);
              }}
            >
              {item.label}
              <span>{data?.counts[item.view] ?? '—'}</span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <div className="comments-error" role="alert">
          <p>{error}</p>
          {data && checkedAt && <small>마지막 확인 · {formatKoreanTime(checkedAt)}</small>}
          <button type="button" onClick={retry} disabled={loading}>
            다시 불러오기
          </button>
        </div>
      )}
      {!data && !error ? (
        <p className="comments-loading" role="status">
          댓글을 불러오는 중…
        </p>
      ) : data?.items.length ? (
        <ol className="comments-list">
          {data.items.map((item) => (
            <ThreadRow key={item.threadId} item={item} onNavigate={onNavigate} />
          ))}
        </ol>
      ) : (
        !error && (
          <div className="comments-empty">
            <MessageCircle size={22} strokeWidth={1.5} />
            <strong>
              {view === 'unread'
                ? '새로 확인할 댓글이 없어요.'
                : view === 'open'
                  ? '미해결 대화가 없어요.'
                  : view === 'resolved'
                    ? '해결된 대화가 없어요.'
                    : '아직 공유 댓글이 없어요.'}
            </strong>
            {!compact &&
              (view === 'unread' && (data?.counts.open ?? 0) > 0 ? (
                <>
                  <p>아직 마무리하지 않은 대화가 {data?.counts.open}개 있어요.</p>
                  <button
                    className="workspace-empty-action"
                    onClick={() => {
                      setView('open');
                      history.replaceState(null, '', '/comments?view=open');
                    }}
                  >
                    미해결 댓글 보기 <ArrowRight size={14} />
                  </button>
                </>
              ) : (
                <p>댓글을 허용한 공유 링크의 방문자 대화가 여기에 모여요.</p>
              ))}
          </div>
        )
      )}
      {!compact && data?.nextCursor && (
        <button
          type="button"
          className="comments-more"
          disabled={loading || moreBusy}
          onClick={() => void loadMore()}
        >
          {moreBusy ? '불러오는 중…' : '댓글 더 보기'}
        </button>
      )}
    </section>
  );
}
export function CommentsWorkspace({ onNavigate }: { onNavigate: (href: string) => void }) {
  return <InboxSurface onNavigate={onNavigate} />;
}
export function CommentsAttention({ onNavigate }: { onNavigate: (href: string) => void }) {
  return <InboxSurface compact onNavigate={onNavigate} />;
}
