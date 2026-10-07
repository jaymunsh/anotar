import { getWorkspaceNotices, subscribeWorkspaceNotices } from '../workspace/notices';
import SyncDetailsDialog from './SyncDetailsDialog';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ChevronRight, Cloud, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import {
  getWorkspaceRuntime,
  getSyncSnapshot,
  subscribeSync,
  requestWorkspaceSync,
} from './runtime';
import { listRecords, type Pending } from './repository';
import { noticeDestination } from './noticeDestination';
import './sync.css';
import { replaceRejectedWrite } from './workflows';
export function SyncStatus({ onNavigate, onOpenStorage }: {
  onNavigate: (path: string) => void;
  onOpenStorage: () => void;
}) {
  const notices = useSyncExternalStore(subscribeWorkspaceNotices, getWorkspaceNotices);
  const [retryingNotice, setRetryingNotice] = useState('');
  const status = useSyncExternalStore(subscribeSync, getSyncSnapshot),
    [open, setOpen] = useState(false),
    [actionError, setActionError] = useState(''),
    [pending, setPending] = useState<Pending[]>([]);
  useEffect(() => {
    void getWorkspaceRuntime().catch(() => {});
  }, []);
  useEffect(() => {
    if (!open) return;
    void getWorkspaceRuntime()
      .then(async ({ workspaceId }) =>
        setPending((await listRecords<Pending>('outbox', workspaceId, 10000))
          .filter(item => item.state === 'conflict' || item.state === 'failed')),
      )
      .catch(() => {});
  }, [open, status]);
  const warning = status.conflicts > 0 || ['access', 'recovery'].includes(status.state),
    attention = warning || notices.length > 0,
    offline = status.state === 'offline';
  const label =
    status.state === 'access'
      ? '로그인·접근 확인 필요'
      : warning
        ? `변경 확인 필요${status.conflicts ? ' ' + status.conflicts + '건' : ''}`
        : offline
          ? `서버 연결 대기${status.pending ? ' · 기기에 저장한 변경 ' + status.pending + '건' : ''}`
          : status.pending
            ? `기기에 저장됨 · 대기 ${status.pending}건`
            : status.state === 'syncing'
              ? '동기화 중…'
              : status.state === 'ready'
                ? '서버 동기화 완료'
                : offline
                  ? '서버 연결 대기'
                  : '저장소 준비 중…';
  const compactLabel = notices.length && !warning ? `안내 확인 · ${notices.length}건` : label;
  const Icon = attention
    ? TriangleAlert
    : offline
      ? CloudOff
      : status.state === 'syncing'
        ? RefreshCw
        : Cloud;
  return (
    <div className="sync-status">
      <button
        type="button"
        className={'sync-status-trigger' + (attention ? ' needs-attention' : '')}
        aria-label="동기화 상태"
        title={notices.length ? `${label} · ${notices.map(notice => notice.title).join(' · ')}` : label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon size={14} aria-hidden />
        <span role="status">{compactLabel}</span>
        {attention && <ChevronRight className="sync-status-more" size={13} aria-hidden />}
      </button>
      {open && (
        <SyncDetailsDialog onClose={() => setOpen(false)}>
          {notices.map(notice => <section className="sync-workspace-notice" key={notice.id} aria-label={notice.title}>
            <h3>{notice.title}</h3>
            <p>{notice.message}</p>
            {notice.retry && <button type="button" className="sync-retry" disabled={retryingNotice === notice.id} onClick={async()=>{
              setRetryingNotice(notice.id);
              try { await notice.retry?.(); } catch { setActionError('안내에 해당하는 작업을 다시 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.'); }
              finally { setRetryingNotice(''); }
            }}>{retryingNotice === notice.id ? '확인 중…' : '다시 시도'}</button>}
          </section>)}
          <p>기기에 저장한 자료는 연결 후 서버에 반영돼요. 공유에는 서버에 반영된 내용만 보여요.</p>
          <dl className="sync-status-facts">
            <div>
              <dt>기기에 저장한 변경</dt>
              <dd>{status.pending ? `${status.pending}건 서버 반영 대기` : '전송 대기 없음'}</dd>
            </div>
            <div>
              <dt>충돌</dt>
              <dd>
                {status.conflicts
                  ? `${status.conflicts}건 · 양쪽 내용 확인 필요`
                  : '확인할 충돌 없음'}
              </dd>
            </div>
          </dl>
          {status.lastSync !== null && (
            <p className="sync-last-checked">
              마지막 서버 확인 · {new Date(status.lastSync).toLocaleString('ko-KR')}
            </p>
          )}
          {offline && (
            <p>
              연결이 돌아오면 자동으로 다시 전송해요. 대기 중인 변경은 공유 화면에 아직 반영되지
              않았어요.
            </p>
          )}
          {status.error && <p role="alert">{status.error}</p>}
          {actionError && <p role="alert">{actionError}</p>}
          {status.state === 'recovery' && <button type="button" className="sync-retry" onClick={() => {
            setOpen(false);
            onOpenStorage();
          }}>기기 저장소에서 확인</button>}
          {!!pending.length && (
            <ul>
              {pending.slice(0, 50).map((item) => (
                <li key={item.operation.operationId}>
                  <span>
                    {String(
                      ('title' in item.operation.payload
                        ? item.operation.payload.title
                        : 'date' in item.operation.payload
                          ? `${item.operation.payload.date} 일지`
                        : 'text' in item.operation.payload
                          ? item.operation.payload.text
                          : item.operation.kind.startsWith('task.') ? '할 일'
                          : item.operation.kind.startsWith('journal.') ? '일지'
                          : item.operation.kind.startsWith('page.') ? '페이지'
                          : '메모') || '새 자료',
                    ).slice(0, 60)}
                  </span>
                  <small>
                    {item.state === 'conflict'
                      ? '양쪽 내용 확인 필요'
                      : item.state === 'failed'
                        ? '저장 내용 확인 필요'
                        : '전송 대기'}
                  </small>
                  {item.error && item.state !== 'conflict' && <small>{item.error}</small>}
                  {item.state === 'failed' &&
                    [404, 413, 422].includes(item.errorStatus ?? 0) &&
                    item.errorCode !== 'payload_mismatch' &&
                    /\.(create|update)$/.test(item.operation.kind) && (
                      <button
                        className="sync-retry"
                        onClick={async () => {
                          try {
                            await replaceRejectedWrite(item.operation.operationId);
                            setActionError('');
                          } catch (error) {
                            setActionError(
                              error instanceof Error ? error.message : '다시 전송하지 못했어요.',
                            );
                          }
                        }}
                      >
                        고친 내용으로 다시 전송
                      </button>
                    )}
                  {item.state === 'conflict' && (
                      <button
                        className="sync-retry"
                        onClick={() => {
                          setOpen(false);
                          onNavigate(noticeDestination(item.operation).path);
                        }}
                      >
                        {noticeDestination(item.operation).label}
                      </button>
                    )}
                </li>
              ))}
            </ul>
          )}
          {pending.length > 50 && <p>확인할 항목이 {pending.length - 50}건 더 있어요. 각 화면에서도 확인할 수 있어요.</p>}
          <button
            type="button"
            className="sync-retry"
            onClick={() => {
              setActionError('');
              void requestWorkspaceSync().catch(() =>
                setActionError('서버 연결을 확인하지 못했어요. 기기에 저장한 변경은 유지돼요.'),
              );
            }}
          >
            지금 동기화
          </button>
        </SyncDetailsDialog>
      )}
    </div>
  );
}
