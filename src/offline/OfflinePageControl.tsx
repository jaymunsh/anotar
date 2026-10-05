import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { pinPage, unpinPage, type PinResult } from './pageCache';
import { getWorkspaceRuntime } from '../sync/runtime';
import { readRecord, subscribeLocalChanges } from '../sync/repository';
export default function OfflinePageControl({ pageId }: { pageId: string }) {
  const [pin, setPin] = useState<PinResult>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setPin(undefined);
    setError('');
    const refresh = () =>
      void getWorkspaceRuntime()
        .then(({ workspaceId }) => readRecord<PinResult>('pins', workspaceId, pageId))
        .then((value) => {
          if (active) setPin(value);
        })
        .catch(() => {
          if (active) setError('기기 보관 상태를 확인하지 못했어요.');
        });
    refresh();
    const unsubscribe = subscribeLocalChanges(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [pageId]);
  async function run(remove = false) {
    setBusy(true);
    setError('');
    try {
      if (remove) {
        await unpinPage(pageId);
        setPin(undefined);
      } else {
        const result = await pinPage({ pageId });
        setPin(result);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '보관을 완료하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  const state = pin?.state ?? 'missing';
  const missingAssets = pin?.missing.filter((item) => item.id !== 'app').length ?? 0;
  const missingApp = pin?.missing.some((item) => item.id === 'app');
  return (
    <div className="offline-page-control">
      <button type="button" disabled={busy} onClick={() => void run()}>
        <Download size={15} />
        {busy
          ? '기기에 보관 중…'
          : state === 'ready'
            ? '오프라인 보관 갱신'
            : state === 'partial'
              ? '일부 자료 다시 보관'
              : '이 페이지 오프라인 보관'}
      </button>
      {state !== 'missing' && (
        <small role="status">
          {state === 'ready'
            ? '문서·직접 첨부 오프라인 사용 가능'
            : state === 'partial'
              ? '일부 자료 미보관'
              : '보관 중…'}
        </small>
      )}
      {state === 'missing' && (
        <small>문서가 기기에 저장되어 있어도 첨부와 앱 파일은 별도 보관이 필요해요.</small>
      )}
      {state === 'partial' && (
        <div className="offline-page-details" role="status">
          {missingAssets > 0 && <p>첨부 {missingAssets}개를 아직 보관하지 못했어요.</p>}
          {missingApp && <p>앱 실행 파일이 준비되지 않아 오프라인 재접속을 보장할 수 없어요.</p>}
          {pin?.successfulVersion && (
            <p>
              마지막 완전 보관본(v{pin.successfulVersion})을 유지하고 있어요. 연결 후 다시 보관해
              주세요.
            </p>
          )}
          <ul>
            {pin?.missing.map((item, index) => (
              <li key={item.id + index}>{item.error}</li>
            ))}
          </ul>
        </div>
      )}
      {state === 'ready' && (
        <small>
          이 페이지의 문서와 직접 첨부를 보관해요. 다른 페이지·외부 링크는 따로 확인해 주세요.
        </small>
      )}
      {state !== 'missing' && (
        <button type="button" disabled={busy} onClick={() => void run(true)}>
          <RefreshCw size={15} />
          기기 보관 해제
        </button>
      )}
      {state !== 'missing' && (
        <small>보관 해제는 이 기기의 사본만 정리해요. 서버 원본과 미전송 변경은 보존돼요.</small>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
