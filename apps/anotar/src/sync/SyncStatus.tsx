import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, CloudOff, TriangleAlert, X } from 'lucide-react';
import { getSyncSnapshot, subscribeSync } from './runtime';
import { getWorkspaceNotices, subscribeWorkspaceNotices } from '../workspace/notices';
import './sync.css';

// 온라인 전용 사이드바 상태. 연결이 끊겼을 때 한 줄로 알리고,
// 화면이 맡긴 안내(즐겨찾기·최근 열람 저장 실패 등)는 `안내 확인 · N건`으로 모아 재시도를 제공한다.
export function SyncStatus() {
  const status = useSyncExternalStore(subscribeSync, getSyncSnapshot);
  const notices = useSyncExternalStore(subscribeWorkspaceNotices, getWorkspaceNotices);
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState('');
  const [actionError, setActionError] = useState('');
  const offline = status.state === 'offline';
  useEffect(() => {
    if (!notices.length) setOpen(false);
  }, [notices.length]);
  if (!offline && !notices.length) return null;
  const label = notices.length ? `안내 확인 · ${notices.length}건` : '연결 끊김 · 저장하려면 연결이 필요해요';
  return (
    <div className="sync-status">
      {notices.length ? (
        <button
          type="button"
          className="sync-status-trigger needs-attention"
          aria-label="안내 확인"
          title={notices.map((notice) => notice.title).join(' · ')}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <TriangleAlert size={14} aria-hidden />
          <span role="status">{label}</span>
          <ChevronRight className="sync-status-more" size={13} aria-hidden />
        </button>
      ) : (
        <span className="sync-status-trigger" role="status" aria-label="연결 상태">
          <CloudOff size={14} aria-hidden />
          <span>{label}</span>
        </span>
      )}
      {open && (
        <NoticeDialog onClose={() => setOpen(false)}>
          {offline && <p>연결이 끊겼어요. 저장하려면 연결이 필요해요.</p>}
          {notices.map((notice) => (
            <section className="sync-workspace-notice" key={notice.id} aria-label={notice.title}>
              <h3>{notice.title}</h3>
              <p>{notice.message}</p>
              {notice.retry && (
                <button
                  type="button"
                  className="sync-retry"
                  disabled={retrying === notice.id}
                  onClick={async () => {
                    setRetrying(notice.id);
                    setActionError('');
                    try {
                      await notice.retry?.();
                    } catch {
                      setActionError('다시 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
                    } finally {
                      setRetrying('');
                    }
                  }}
                >
                  {retrying === notice.id ? '확인 중…' : '다시 시도'}
                </button>
              )}
            </section>
          ))}
          {actionError && <p role="alert">{actionError}</p>}
        </NoticeDialog>
      )}
    </div>
  );
}

function NoticeDialog({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    closeButton.current?.focus();
    return () => {
      node?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="sync-status-panel"
      aria-labelledby="sync-notice-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <header>
        <h2 id="sync-notice-title">확인할 안내</h2>
        <button ref={closeButton} type="button" aria-label="안내 닫기" onClick={onClose}>
          <X size={18} aria-hidden />
        </button>
      </header>
      <div className="sync-details-body">{children}</div>
    </dialog>,
    document.body,
  );
}
