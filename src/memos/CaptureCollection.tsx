import { WorkspaceToolbar, ToolbarSearch } from '../workspace/WorkspaceToolbar';
import {
  ArrowRight,
  ArrowUpRight,
  File,
  Image,
  Link2,
  Paperclip,
  Plus,
  Search,
  ListChecks,
  WandSparkles,
} from 'lucide-react';
import type { RefObject } from 'react';
import { useEffect, useState } from 'react';
import type { Capture, Filter, Kind, MemoScope, Organization } from './types';
import { formatKoreanTime, isNewCapture } from '../time';
import { aiStatusLabel } from '../ai/types';
import './memos.css';

export const kinds: { id: Kind; label: string; icon: typeof File }[] = [
  { id: 'note', label: '메모', icon: File },
  { id: 'link', label: '링크', icon: Link2 },
  { id: 'image', label: '이미지', icon: Image },
  { id: 'file', label: '파일', icon: Paperclip },
];
const filters: { id: Filter; label: string }[] = [{ id: 'all', label: '전체' }, ...kinds];
export function iconFor(kind: Kind) {
  return kinds.find((item) => item.id === kind)?.icon || File;
}
export function fileSize(size: number) {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
export function capturePreview(item: Capture) {
  const input = item.aiRequest?.input;
  return (
    input?.content ||
    input?.url ||
    item.text ||
    item.url ||
    item.files.map((file) => file.name).join(', ') ||
    '내용 없음'
  );
}
function captureSecondary(item: Capture) {
  if (item.aiRequest) return item.aiRequest.template?.name || '직접 요청';
  if (item.url && item.text) {
    try {
      return new URL(item.url).hostname.replace(/^www\./, '');
    } catch {
      return item.url;
    }
  }
  if (item.files.length && item.text) return `${item.files.length}개의 첨부 파일`;
  return null;
}
type Props = {
  items: Capture[];
  now: number;
  loading: boolean;
  error: string;
  compact?: boolean;
  onNext?:()=>void;
  onPrevious?:()=>void;
  counts: { memo: number; ai: number };
  scope: MemoScope;
  onScope: (scope: MemoScope) => void;
  organization: Organization;
  onOrganization: (organization: Organization) => void;
  query: string;
  onQuery: (query: string) => void;
  filter: Filter;
  onFilter: (filter: Filter) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onOpen: (item: Capture) => void;
  onCreate: () => void;
  onViewAll: () => void;
  onRetry: () => void;
  onBatchOrganize?: (captures: Capture[]) => void;
  batchDisabled?: boolean;
  hasPendingBatch?: boolean;
  selectedId?: string | null;
};

export default function CaptureCollection(props: Props) {
  const { items, now, loading, error, compact, scope, counts, query, filter, searchRef } = props;
  const ai = scope === 'ai';
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionError, setSelectionError] = useState('');
  const selectionScope = `${scope}:${props.organization}:${filter}:${query}`;
  useEffect(() => {
    setSelectedIds(new Set());
    setSelecting(false);
    setSelectionError('');
  }, [selectionScope]);
  useEffect(() => {
    const visible = new Set(items.map((item) => item.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [items]);
  const canSelect = !compact && !ai && props.organization === 'inbox' && !!props.onBatchOrganize;
  function selectItem(id: string, selected: boolean) {
    if (props.batchDisabled) return;
    if (selected && selectedIds.size >= 20) {
      setSelectionError('한 번에 20개까지 선택할 수 있어요.');
      return;
    }
    setSelectionError('');
    setSelectedIds((current) => {
      const next = new Set(current);
      selected ? next.add(id) : next.delete(id);
      return next;
    });
  }
  return (
    <section
      className={`recent-section memo-collection ${compact ? 'memo-recent' : ''}`}
      aria-label={compact ? '최근 보관한 항목' : ai ? 'AI 요청 관리' : '메모 관리'}
    >
      {compact ? (
        <div className="section-heading memo-heading">
          <h2>최근 메모</h2>
          <button className="shortcut-button" onClick={props.onViewAll}>
            <span>모두 보기</span>
            <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <WorkspaceToolbar title="메모">
          <ToolbarSearch active={!!query}>
            <label className="search-box">
              <Search size={17} />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => props.onQuery(event.target.value)}
                placeholder={ai ? '요청문 검색' : '보관함 검색'}
                aria-label="보관함 검색"
              />
            </label>
          </ToolbarSearch>
          {canSelect && items.length > 0 && (
            <button
              type="button"
              className="toolbar-icon-mobile"
              aria-label={selecting ? '선택 취소' : '메모 선택'}
              title={selecting ? '선택 취소' : '메모 선택'}
              aria-pressed={selecting}
              disabled={props.batchDisabled || props.hasPendingBatch}
              onClick={() => {
                setSelecting(!selecting);
                setSelectedIds(new Set());
                setSelectionError('');
              }}
            >
              <ListChecks size={16} />
              <span>{selecting ? '선택 취소' : '메모 선택'}</span>
            </button>
          )}
          <button
            className="toolbar-primary toolbar-icon-mobile"
            onClick={props.onCreate}
            aria-label={ai ? 'AI 요청 작성' : '기록하기'}
            title={ai ? 'AI 요청 작성' : '기록하기'}
          >
            <Plus size={16} />
            <span>{ai ? 'AI 요청 작성' : '기록하기'}</span>
          </button>
        </WorkspaceToolbar>
      )}
      {!compact && props.hasPendingBatch && props.onBatchOrganize && (
        <div className="memo-batch-recovery" role="status">
          <span>확인하지 못한 함께 정리 요청이 있어요.</span>
          <button
            type="button"
            disabled={props.batchDisabled}
            onClick={() => props.onBatchOrganize?.([])}
          >
            같은 요청 확인
          </button>
        </div>
      )}
      {canSelect && items.length > 0 && selecting && (
        <div className="memo-selection-bar">
          {selecting && (
            <>
              <span>{selectedIds.size}개 선택 · 최대 20개</span>
              <button
                type="button"
                disabled={props.batchDisabled || props.hasPendingBatch || !selectedIds.size}
                onClick={() =>
                  props.onBatchOrganize?.(items.filter((item) => selectedIds.has(item.id)))
                }
              >
                한 페이지에 정리
              </button>
            </>
          )}
          {selectionError && <span role="alert">{selectionError}</span>}
        </div>
      )}
      {!compact && (
        <>
          <div className="memo-tabs" role="tablist" aria-label="보관 목록">
            {(
              [
                { id: 'memo', label: '보관한 메모' },
                { id: 'ai', label: '요청 원본' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                role="tab"
                id={`memo-tab-${tab.id}`}
                aria-controls="memo-items"
                aria-selected={scope === tab.id}
                onClick={() => props.onScope(tab.id)}
              >
                {tab.label}
                <span>{counts[tab.id]}</span>
              </button>
            ))}
          </div>
          <div className="filter-bar">
            <label className="memo-organization-filter">
              <span>정리 상태</span>
              <select
                aria-label="메모 정리 상태"
                value={props.organization}
                onChange={(event) => props.onOrganization(event.target.value as Organization)}
              >
                <option value="inbox">입력함</option>
                <option value="organized">정리 완료</option>
              </select>
            </label>
            <div className="filter-list" role="tablist" aria-label="항목 필터">
              {filters.map((option) => (
                <button
                  key={option.id}
                  role="tab"
                  aria-selected={filter === option.id}
                  className={`filter-chip ${filter === option.id ? 'active' : ''}`}
                  onClick={() => props.onFilter(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <div
        id={compact ? undefined : 'memo-items'}
        role={compact ? undefined : 'tabpanel'}
        aria-labelledby={compact ? undefined : `memo-tab-${scope}`}
      >
        {error ? (
          <div className="memo-list-error" role="alert">
            <p>{error}</p>
            <button onClick={props.onRetry}>다시 불러오기</button>
          </div>
        ) : loading ? (
          <div className="empty-state loading-state">보관함을 불러오는 중…</div>
        ) : !items.length ? (
          <div className="empty-state memo-empty">
            <h3>
              {query || filter !== 'all'
                ? '찾는 항목이 없어요'
                : props.organization === 'organized'
                  ? '정리 완료한 항목이 없어요'
                  : ai
                    ? '아직 보관한 AI 요청이 없어요'
                    : '아직 보관한 메모가 없어요'}
            </h3>
            <p>
              {query || filter !== 'all'
                ? '다른 단어로 검색하거나 필터를 바꿔보세요.'
                : props.organization === 'organized'
                  ? '페이지로 정리한 원본을 여기서 다시 확인할 수 있어요.'
                  : ai
                    ? '기록할 때 AI 요청을 선택하면 여기에 모여요.'
                    : '생각이 떠오르면 가볍게 기록해두세요.'}
            </p>
            {!compact && (
              <button
                className="workspace-empty-action"
                onClick={() => {
                  if (query || filter !== 'all') {
                    props.onQuery('');
                    props.onFilter('all');
                  } else if (props.organization === 'organized') props.onOrganization('inbox');
                  else props.onCreate();
                }}
              >
                {query || filter !== 'all'
                  ? '검색·필터 초기화'
                  : props.organization === 'organized'
                    ? '입력함 메모 보기'
                    : ai
                      ? 'AI 요청 작성'
                      : '메모 작성'}
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        ) : (
          <div className="capture-list">
            {(compact ? items.slice(0, 3) : items).map((item) => {
              const Icon = item.aiRequest ? WandSparkles : iconFor(item.kind);
              const image = item.files.find((file) => file.mime.startsWith('image/'));
              const secondary = captureSecondary(item);
              return (
                <div className={selecting ? 'capture-select-row' : 'capture-row'} key={item.id}>
                  {selecting && (
                    <label className="capture-select-control">
                      <input
                        type="checkbox"
                        aria-label={`${capturePreview(item)} 선택`}
                        checked={selectedIds.has(item.id)}
                        disabled={props.batchDisabled}
                        onChange={(event) => selectItem(item.id, event.target.checked)}
                      />
                    </label>
                  )}
                  <button
                    className={`capture-card${image ? ' capture-card-has-image' : ''}${secondary ? ' capture-card-has-secondary' : ''}`}
                    data-capture-id={item.id}
                    aria-current={props.selectedId === item.id ? 'true' : undefined}
                    onClick={() => props.onOpen(item)}
                  >
                    <span className={`capture-icon capture-icon-${item.kind}`}>
                      <Icon size={20} strokeWidth={1.8} />
                    </span>
                    <span className="capture-card-main">
                      <span className="capture-card-top">
                        <span className="capture-type">
                          {item.aiRequest
                            ? 'AI 요청'
                            : kinds.find((kind) => kind.id === item.kind)?.label}
                        </span>
                        <time
                          className="capture-date"
                          dateTime={item.createdAt}
                          title={formatKoreanTime(item.createdAt)}
                        >
                          {formatKoreanTime(item.createdAt)}
                        </time>
                        {item.syncState === 'pending' && <span className="capture-sync-pending">전송 대기</span>}
                      </span>
                      <span className="capture-preview">{capturePreview(item)}</span>
                      {secondary && (
                        <span className="capture-secondary">
                          <span className="capture-secondary-text">{secondary}</span>
                          {item.aiRequest && (
                            <span className="memo-request-state">
                              {aiStatusLabel(item.latestAiJob)}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    {isNewCapture(item.createdAt, now) && <span className="capture-new">NEW</span>}
                    {image && (
                      <img
                        className="capture-thumb"
                        src={image.localUrl ?? `/api/assets/${image.id}`}
                        alt=""
                        loading="lazy"
                      />
                    )}
                    <ArrowUpRight size={18} className="capture-arrow" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {!compact && (props.onNext||props.onPrevious) && <nav className="memo-pagination" aria-label="메모 목록 페이지"><button type="button" disabled={!props.onPrevious||loading} onClick={props.onPrevious}>이전 50개</button><span>50개씩 보기</span><button type="button" disabled={!props.onNext||loading} onClick={props.onNext}>다음 50개</button></nav>}

      </div>
    </section>
  );
}
