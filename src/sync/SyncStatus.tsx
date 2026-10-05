import { useEffect, useState, useSyncExternalStore } from 'react';
import { Cloud, CloudOff, RefreshCw, TriangleAlert, X } from 'lucide-react';
import {
  getWorkspaceRuntime,
  getSyncSnapshot,
  subscribeSync,
  requestWorkspaceSync,
} from './runtime';
import { listRecords, readRecord, type Pending } from './repository';
import ConflictPanel from './ConflictPanel';
import type { ConflictRecord } from './conflicts';
import './sync.css';
import { replaceRejectedWrite } from './workflows';
import RecoveryPanel from '../offline/RecoveryPanel';
export function SyncStatus() {
  const status = useSyncExternalStore(subscribeSync, getSyncSnapshot),
    [open, setOpen] = useState(false),
    [actionError, setActionError] = useState(''),
    [pending, setPending] = useState<Pending[]>([]),
    [conflict, setConflict] = useState<ConflictRecord>();
  useEffect(() => {
    void getWorkspaceRuntime().catch(() => {});
  }, []);
  useEffect(() => {
    if (!open) return;
    void getWorkspaceRuntime()
      .then(async ({ workspaceId }) =>
        setPending(await listRecords<Pending>('outbox', workspaceId, 50)),
      )
      .catch(() => {});
  }, [open, status]);
  const warning = status.conflicts > 0 || ['access', 'recovery'].includes(status.state),
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
  const Icon = warning
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
        className="sync-status-trigger"
        aria-label="동기화 상태"
        title={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon size={14} aria-hidden />
        <span role="status">{label}</span>
      </button>
      {open && (
        <section className="sync-status-panel" aria-label="기기 저장과 동기화">
          <header>
            <strong>기기 저장과 동기화</strong>
            <button type="button" aria-label="동기화 상태 닫기" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </header>
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
          {status.state === 'recovery' && <RecoveryPanel />}
          {!!pending.length && (
            <ul>
              {pending.map((item) => (
                <li key={item.operation.operationId}>
                  <span>
                    {String(
                      ('title' in item.operation.payload
                        ? item.operation.payload.title
                        : 'date' in item.operation.payload
                          ? `${item.operation.payload.date} 일지`
                        : 'text' in item.operation.payload
                          ? item.operation.payload.text
                          : item.operation.kind) || '새 자료',
                    ).slice(0, 60)}
                  </span>
                  <small>
                    {item.state === 'conflict'
                      ? '양쪽 내용 확인 필요'
                      : item.state === 'failed'
                        ? '저장 내용 확인 필요'
                        : '전송 대기'}
                  </small>
                  {item.error && <small>{item.error}</small>}
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
                  {item.state === 'conflict' &&
                    item.operation.kind !== 'ai.submit' &&
                    item.operation.kind !== 'capture.organize' && (
                      <button
                        className="sync-retry"
                        onClick={async () => {
                          const { workspaceId } = await getWorkspaceRuntime();
                          setConflict(
                            await readRecord<ConflictRecord>(
                              'conflicts',
                              workspaceId,
                              item.operation.operationId,
                            ),
                          );
                        }}
                      >
                        양쪽 내용 확인
                      </button>
                    )}
                </li>
              ))}
            </ul>
          )}
          {conflict && (
            <ConflictPanel
              conflict={conflict}
              local={conflict.local}
              onResolved={() => {
                setConflict(undefined);
              }}
            />
          )}
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
        </section>
      )}
    </div>
  );
}
