import { useEffect, useState } from 'react';
import { getWorkspaceRuntime } from '../sync/runtime';
import { listRecords, subscribeLocalChanges } from '../sync/repository';
import { storageStatus, requestPersistentStorage, OFFLINE_BUDGET } from './storage';
import { Download, ShieldCheck } from 'lucide-react';
import { unpinPage, type PinResult } from './pageCache';
import { exportPendingWorkspace } from './exportPending';
export default function DeviceStorage() {
  const [pins, setPins] = useState<PinResult[]>([]),
    [message, setMessage] = useState(''),
    [usage, setUsage] = useState<{ bytes: number; persisted: boolean } | null>(null),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      const { workspaceId } = await getWorkspaceRuntime();
      const [rows, storage] = await Promise.all([
        listRecords<PinResult>('pins', workspaceId, 1000),
        storageStatus(workspaceId),
      ]);
      setPins(rows);
      setUsage({ bytes: storage.bytes, persisted: storage.persisted });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '저장소를 확인하지 못했어요.');
    }
  }
  useEffect(() => {
    void load();
    return subscribeLocalChanges(() => void load());
  }, []);
  return (
    <section className="settings-storage" aria-labelledby="settings-storage-title">
      <h3 id="settings-storage-title">기기 저장소</h3>
      <p className="settings-description">
        보관한 페이지는 연결 없이 열 수 있어요. 미전송 변경과 첨부는 보관 해제로 지워지지 않아요.
      </p>
      <div className="settings-storage-usage">
        <strong>{usage ? `${(usage.bytes / 1024 / 1024).toFixed(1)} MB` : '확인 중…'}</strong>
        <span>/ 보관 예산 {OFFLINE_BUDGET / 1024 / 1024} MB</span>
      </div>
      <p className="settings-storage-state">
        {usage
          ? usage.persisted
            ? '저장 공간 유지 허용'
            : '브라우저 저장 공간 사용'
          : '저장 공간 확인 중…'}
      </p>
      <div className="settings-storage-actions">
        <button
          className="settings-storage-action"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const allowed = await requestPersistentStorage();
            setMessage(
              allowed
                ? '브라우저가 저장 공간 유지를 허용했어요.'
                : '브라우저가 영구 유지를 허용하지 않았어요. 서버 동기화와 백업을 함께 사용해 주세요.',
            );
            setBusy(false);
            void load();
          }}
        >
          <ShieldCheck size={15} aria-hidden="true" />
          저장 공간 유지 요청
        </button>
        <button
          className="settings-storage-action"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const { workspaceId } = await getWorkspaceRuntime(),
                result = await exportPendingWorkspace(workspaceId),
                url = URL.createObjectURL(result.blob),
                a = document.createElement('a');
              a.href = url;
              a.download = result.filename;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 60000);
              setMessage(
                '기기 변경과 첨부 사본을 내려받았어요. ZIP 안의 manifest.json에 대기 요청과 복구 정보가 있어요.',
              );
            } catch (cause) {
              setMessage(
                cause instanceof Error ? cause.message : '내보내지 못했어요. 자료는 유지했어요.',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download size={15} aria-hidden="true" />
          전송 대기 자료 내보내기
        </button>
      </div>
      <div className="settings-pin-heading">
        <h4>보관한 페이지</h4>
        <span>{pins.length}개</span>
      </div>
      {pins.length ? (
        <ul className="settings-pins">
          {pins.map((pin) => (
            <li key={pin.pageId}>
              <div className="settings-pin-copy">
                <strong>{pin.title || '제목 없음'}</strong>
                <small>{pin.state === 'ready' ? '사용 가능' : '일부 자료 미보관'}</small>
              </div>
              <button
                className="settings-pin-release"
                aria-label={`${pin.title || '제목 없음'} 보관 해제`}
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await unpinPage(pin.pageId);
                  } catch (cause) {
                    setMessage(String(cause));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                보관 해제
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="settings-storage-empty">
          아직 보관한 페이지가 없어요. 페이지의 ··· 메뉴에서 보관할 수 있어요.
        </p>
      )}
      {message && (
        <p className="settings-storage-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
