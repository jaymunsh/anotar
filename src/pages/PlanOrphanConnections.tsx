import { useContext, useEffect, useRef, useState } from 'react';
import { CheckSquare, RefreshCw, Unlink, X } from 'lucide-react';
import { PlanConnectionsContext } from './PlanConnectionsContext';
import './planConnections.css';
const managerEvent = 'leneu:plan-connections-manage';
export function openPlanConnectionManager(pageId: string) {
  window.dispatchEvent(new CustomEvent(managerEvent, { detail: { pageId } }));
}
export default function PlanOrphanConnections({ editable }: { editable: boolean }) {
  const context = useContext(PlanConnectionsContext),
    [open, setOpen] = useState(false),
    panel = useRef<HTMLElement | null>(null),
    trigger = useRef<HTMLElement | null>(null);
  const pageId = context?.pageId,
    refreshAll = context?.refreshAll;
  useEffect(() => {
    const onOpen = (event: Event) => {
      if ((event as CustomEvent<{ pageId?: string }>).detail?.pageId !== pageId) return;
      trigger.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
      refreshAll?.();
    };
    window.addEventListener(managerEvent, onOpen);
    return () => window.removeEventListener(managerEvent, onOpen);
  }, [pageId, refreshAll]);
  useEffect(() => {
    if (open) {
      panel.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      panel.current?.focus({ preventScroll: true });
    }
  }, [open]);
  if (!context || !open) return null;
  const rows = context.items.filter((row) => row.sourceMissing || row.unavailable),
    disabled = !editable || context.busy || !!context.pending || context.loading;
  const close = () => {
    setOpen(false);
    const target =
      trigger.current?.isConnected && trigger.current.getClientRects().length
        ? trigger.current
        : document.querySelector<HTMLElement>('[aria-label="페이지 정보"]');
    target?.focus({ preventScroll: true });
  };
  return (
    <section
      className="plan-orphan-manager"
      aria-label="일정 연결 관리"
      tabIndex={-1}
      ref={panel}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className="plan-connections-head">
        <CheckSquare size={16} />
        <strong>일정 연결 관리</strong>
        <button
          type="button"
          aria-label="일정 연결 관리 새로고침"
          disabled={context.busy || !!context.pending}
          onClick={context.refreshAll}
        >
          <RefreshCw size={14} />
        </button>
        <button type="button" aria-label="일정 연결 관리 닫기" onClick={close}>
          <X size={16} />
        </button>
      </div>
      <p className="plan-orphan-description">
        일정에서 빠졌거나 원본을 찾을 수 없는 연결을 정리합니다. 연결을 해제해도 할 일·메모·페이지
        원본은 남습니다.
      </p>
      {context.error && <p role="alert">{context.error}</p>}
      {context.pending && (
        <div className="plan-connections-retry">
          <p>확인하지 못한 연결 요청이 남아 있어요.</p>
          <button
            type="button"
            disabled={!editable || context.busy}
            onClick={() => void context.retry()}
          >
            같은 요청 다시 시도
          </button>
          <button type="button" disabled={!editable || context.busy} onClick={context.discard}>
            요청 수정
          </button>
        </div>
      )}
      {context.loading ? (
        <p role="status">연결을 불러오는 중…</p>
      ) : !rows.length ? (
        <p>정리할 연결이 없어요. 사용 중인 연결은 각 일정 항목에서 관리할 수 있어요.</p>
      ) : (
        <ul className="plan-orphan-list">
          {rows.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{row.title}</strong>
                <small>
                  {row.entryTitle || '이전 일정 항목'} ·{' '}
                  {row.sourceMissing ? '일정에서 빠짐' : '원본을 찾을 수 없음'}
                  {row.shared ? ' · 공개 표시 제외됨' : ''}
                </small>
              </div>
              <button
                type="button"
                aria-label={`${row.title} 연결 해제`}
                disabled={disabled}
                onClick={() =>
                  void context.change({
                    action: 'unlink',
                    blockId: row.blockId,
                    entryId: row.entryId,
                    relationId: row.id,
                    expectedVersion: row.version,
                  })
                }
              >
                <Unlink size={14} />
                <span>연결 해제</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
