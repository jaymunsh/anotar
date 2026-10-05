import { WorkspaceToolbar } from '../workspace/WorkspaceToolbar';
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type { AiActivity as Activity, AiActivityFilter, AiActivityItem } from './types';
import { aiStatusLabel } from './types';
import { getAiActivity } from './api';
import { formatKoreanTime } from '../time';
import { subscribeRecordChanges } from '../trash/events';
import './activity.css';
import WorkflowQueue from '../sync/WorkflowQueue';

function initialFilter(): AiActivityFilter {
  const value = new URLSearchParams(window.location.search).get('status');
  return value === 'active' || value === 'result_ready' || value === 'failed' ? value : 'all';
}
function State({ item }: { item: AiActivityItem }) {
  const Icon =
    item.status === 'running'
      ? LoaderCircle
      : item.status === 'queued'
        ? Clock3
        : item.status === 'failed'
          ? TriangleAlert
          : CheckCircle2;
  return (
    <span className={`activity-state activity-state-${item.status}`}>
      <Icon size={14} aria-hidden="true" />
      {aiStatusLabel(item)}
    </span>
  );
}

export default function AiActivity({
  compact = false,
  onNavigate,
  onCreate,
}: {
  compact?: boolean;
  onNavigate: (href: string) => void;
  onCreate: () => void;
}) {
  const [filter, setFilter] = useState<AiActivityFilter>(compact ? 'all' : initialFilter);
  const [data, setData] = useState<(Activity & { filter: AiActivityFilter }) | null>(null);
  const [checkedAt, setCheckedAt] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const surface = useRef<HTMLElement>(null);
  useEffect(() => {
    let stopped = false,
      visible = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    async function refresh() {
      if (stopped || document.hidden || !visible) return;
      clearTimeout(timer);
      controller?.abort();
      const current = new AbortController();
      controller = current;
      let delay = 30_000;
      try {
        const activity = await getAiActivity(compact, filter, current.signal);
        if (stopped || current.signal.aborted) return;
        setData({ ...activity, filter });
        setCheckedAt(new Date().toISOString());
        setError('');
        if (activity.counts.queued + activity.counts.running) delay = 2000;
      } catch {
        if (stopped || current.signal.aborted) return;
        setError('상태를 갱신하지 못했어요. 연결을 확인하고 다시 불러와 주세요.');
      }
      if (!stopped && visible && !document.hidden) timer = setTimeout(() => void refresh(), delay);
    }
    const schedule = () => {
      clearTimeout(timer);
      controller?.abort();
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
      clearTimeout(timer);
      controller?.abort();
      observer.disconnect();
      unsubscribe();
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [compact, filter, reload]);
  const ready = data?.filter === filter;
  const counts = data?.counts;
  const allCount = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;
  const groups = [
    {
      id: 'all',
      label: '전체',
      count: allCount,
    },
    { id: 'active', label: '진행 중', count: counts ? counts.queued + counts.running : undefined },
    { id: 'result_ready', label: '결과 준비', count: counts?.result_ready },
    { id: 'failed', label: '실패', count: counts?.failed },
  ] as const;
  function follow(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(href);
  }
  return (
    <section
      ref={surface}
      className={`ai-activity ${compact ? 'activity-compact' : ''}`}
      aria-label={compact ? 'AI 요청 현황' : 'AI 요청 모니터'}
    >
      <WorkflowQueue onlyAi />
      {compact ? (
        <div className="activity-heading">
          <h2>
            <Sparkles size={17} /> AI 작업
          </h2>
          <a href="/ai" onClick={(event) => follow(event, '/ai')}>
            모두 보기 <ArrowRight size={16} />
          </a>
        </div>
      ) : (
        <WorkspaceToolbar
          title="AI 작업"
          meta={checkedAt ? `확인 ${formatKoreanTime(checkedAt)}` : undefined}
        >
          <button
            className="toolbar-icon-mobile"
            aria-label="AI 상태 새로고침"
            title="AI 상태 새로고침"
            onClick={() => setReload((value) => value + 1)}
          >
            <RefreshCw size={16} />
            <span>새로고침</span>
          </button>
          <button
            className="toolbar-primary toolbar-icon-mobile"
            aria-label="새 AI 요청"
            title="새 AI 요청"
            onClick={onCreate}
          >
            <Sparkles size={16} />
            <span>새 AI 요청</span>
          </button>
        </WorkspaceToolbar>
      )}
      <div
        className="activity-filters"
        role={compact ? undefined : 'tablist'}
        aria-label={compact ? 'AI 요청 개수' : 'AI 처리 상태'}
      >
        {groups
          .filter((group) => !compact || group.id !== 'all')
          .map((group) =>
            compact ? (
              <a
                key={group.id}
                href={`/ai?status=${group.id}`}
                onClick={(event) => follow(event, `/ai?status=${group.id}`)}
              >
                {group.label} <span>{group.count ?? '—'}</span>
              </a>
            ) : (
              <button
                key={group.id}
                role="tab"
                id={`activity-tab-${group.id}`}
                aria-selected={filter === group.id}
                aria-controls="activity-items"
                onClick={() => setFilter(group.id)}
              >
                {group.label} <span>{group.count ?? '—'}</span>
              </button>
            ),
          )}
      </div>
      {error && (
        <div className="activity-error" role="alert">
          <p>
            {error}
            {ready ? ' 표시된 상태는 마지막 확인 기준이에요.' : ''}
          </p>
          <button onClick={() => setReload((value) => value + 1)}>다시 불러오기</button>
        </div>
      )}
      <div
        id={compact ? undefined : 'activity-items'}
        role={compact ? undefined : 'tabpanel'}
        aria-labelledby={compact ? undefined : `activity-tab-${filter}`}
      >
        {!ready ? (
          !error && (
            <p className="activity-message" role="status">
              요청 상태를 확인하는 중…
            </p>
          )
        ) : !data.items.length ? (
          <div className="activity-message activity-empty">
            <p>
              {filter === 'active'
                ? '진행 중인 요청이 없어요.'
                : filter === 'result_ready'
                  ? '준비된 결과가 없어요.'
                  : filter === 'failed'
                    ? '실패한 요청이 없어요.'
                    : '아직 실행한 AI 요청이 없어요.'}
            </p>
            {!compact && (
              <button
                className="workspace-empty-action"
                onClick={() => {
                  if (filter !== 'all' && (allCount ?? 0) > 0) setFilter('all');
                  else onCreate();
                }}
              >
                {filter !== 'all' && (allCount ?? 0) > 0 ? '전체 요청 보기' : '새 AI 요청'}
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        ) : (
          <div className="activity-list">
            {data.items.map((item) => (
              <a
                className="activity-row"
                key={item.id}
                data-ai-job-id={item.id}
                href={item.href}
                onClick={(event) => follow(event, item.href)}
              >
                <span className="activity-row-meta">
                  <span className="activity-owner">
                    {item.ownerKind === 'page' ? '페이지' : '메모'}
                  </span>
                  <span className="activity-template">
                    {item.templateName}{item.templateVersion ? ` · v${item.templateVersion}` : ''}
                  </span>
                  {item.organized && <span className="activity-organized">정리 완료</span>}
                </span>
                <State item={item} />
                <span className="activity-preview">{item.preview || '저장된 요청'}</span>
                <span className="activity-action">
                  <span>
                    {item.status === 'result_ready'
                      ? '결과 보기'
                      : item.status === 'failed'
                        ? '오류 확인'
                        : '진행 보기'}
                  </span>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </span>
                {!compact && (
                  <span className="activity-row-time">
                    {item.executionLabel && <span>{item.executionLabel}{item.model && !item.executionLabel.includes(item.model) ? ` · ${item.model}` : ''}</span>}
                    <time dateTime={item.createdAt}>요청 {formatKoreanTime(item.createdAt)}</time>
                    {item.startedAt && !item.finishedAt && (
                      <time dateTime={item.startedAt}>시작 {formatKoreanTime(item.startedAt)}</time>
                    )}
                    {item.finishedAt && (
                      <time dateTime={item.finishedAt}>
                        {item.status === 'failed' ? '종료' : '완료'}{' '}
                        {formatKoreanTime(item.finishedAt)}
                      </time>
                    )}
                  </span>
                )}
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="activity-footer">
        <a href="/memo?view=ai" onClick={(event) => follow(event, '/memo?view=ai')}>
          요청 원본 보기 <ArrowUpRight size={14} />
        </a>
      </div>
      {!compact && ready && data.total > data.items.length && (
        <p className="activity-limit">
          선택한 상태의 최근 50개를 보여주고 있어요. 이전 이력은 해당 메모·페이지에서 확인할 수
          있어요.
        </p>
      )}
    </section>
  );
}
