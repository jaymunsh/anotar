import { useEffect, useState } from 'react';
import { recoveryOverview, reconnectAfterReview } from './recovery';
import { exportPendingWorkspace } from './exportPending';
export default function RecoveryPanel() {
  const [data, setData] = useState<Awaited<ReturnType<typeof recoveryOverview>>>(),
    [reviewed, setReviewed] = useState(false),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [exportWarning, setExportWarning] = useState('');
  useEffect(() => {
    let active = true;
    void recoveryOverview()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '복구 내용을 확인하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="sync-recovery" aria-label="서버 변경 복구">
      <strong>서버 자료를 다시 확인해 주세요</strong>
      <p>
        자동 전송을 멈췄어요. 기기 사본을 내려받고 연결할 서버를 확인해 주세요. 이전 AI·정리 요청은
        자동 재실행하지 않아요.
      </p>
      {data && (
        <>
          <p>
            {data.server.workspaceId === data.workspaceId
              ? '같은 작업 공간의 복원 또는 동기화 기록 변경'
              : '다른 작업 공간'}{' '}
            · 기기 변경 {data.entities.length}개 · 대기 {data.outbox.length}건
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const result = await exportPendingWorkspace(data.workspaceId),
                  url = URL.createObjectURL(result.blob),
                  a = document.createElement('a');
                a.href = url;
                a.download = result.filename;
                a.click();
                if (result.manifest.missingAssets.length) {
                  setReviewed(false);
                  setExportWarning(
                    '본문과 기기에 있는 첨부를 내려받았어요. 기기에 없는 서버 첨부 ' +
                      result.manifest.missingAssets.length +
                      '개는 ZIP의 missingAssets에 표시했어요. 원 서버 백업도 보관하고 확인한 뒤 연결해 주세요.',
                  );
                } else setExportWarning('');
                setTimeout(() => URL.revokeObjectURL(url), 60000);
              })
            }
          >
            기기 사본 ZIP 내려받기
          </button>
          {exportWarning && <p role="alert">{exportWarning}</p>}
          {data.server.workspaceId === data.workspaceId && data.entities.length > 0 && (
            <fieldset>
              <legend>서버 자료를 확인한 뒤 다시 반영할 변경</legend>
              {data.entities.map((entity) => (
                <label key={entity.key}>
                  <input
                    type="checkbox"
                    checked={selected.has(entity.key)}
                    disabled={busy}
                    onChange={(event) =>
                      setSelected((old) => {
                        const next = new Set(old);
                        if (event.target.checked) next.add(entity.key);
                        else next.delete(entity.key);
                        return next;
                      })
                    }
                  />
                  <span>
                    {String(entity.current?.title ?? entity.current?.text ?? (entity.kind==='journal' ? `${entity.current?.date} 일지` : '기기 변경')).slice(
                      0,
                      70,
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            기기 사본을 보관했고, 서버와 반영할 변경을 확인했어요.
          </label>
          <button
            disabled={busy || !reviewed}
            onClick={() =>
              void perform(async () => {
                await reconnectAfterReview({ reviewed, selectedKeys: [...selected] });
                location.reload();
              })
            }
          >
            확인한 서버에 다시 연결
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
