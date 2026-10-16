import {onlineActionFetch} from '../sync/onlineActions';
import { useEffect, useState } from 'react';
import type { Capture } from './types';
import { publishRecordChange } from '../trash/events';

export default function CaptureOrganization({
  capture,
  onRestored,
  disabled,
}: {
  capture: Capture;
  onRestored: (item: Capture) => void;
  disabled: boolean;
}) {
  const key = 'leneu:capture-unorganize:' + capture.id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pageState, setPageState] = useState<'loading' | 'active' | 'missing' | 'error'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    setPageState('loading');
    if (!capture.organizedPageId) {
      setPageState('missing');
      return;
    }
    void fetch('/api/pages/' + capture.organizedPageId, { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted)
          setPageState(response.ok ? 'active' : response.status === 404 ? 'missing' : 'error');
      })
      .catch(() => {
        if (!controller.signal.aborted) setPageState('error');
      });
    return () => controller.abort();
  }, [capture.organizedPageId]);
  async function restore() {
    if (busy || disabled) return;
    setBusy(true);
    setError('');
    try {
      const body = JSON.parse(localStorage.getItem(key) || 'null') || {
        operationId: crypto.randomUUID(),
        expectedOrganizedOperationId: capture.organizedOperationId,
      };
      localStorage.setItem(key, JSON.stringify(body));
      const response = await onlineActionFetch(`/api/captures/${capture.id}/unorganize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || !data.item) {
        if ([400, 404, 409].includes(response.status)) localStorage.removeItem(key);
        throw new Error(data.error || '입력함 복원 여부를 확인하지 못했어요. 다시 시도해 주세요.');
      }
      localStorage.removeItem(key);
      const current = await fetch('/api/captures/' + capture.id);
      if (!current.ok) throw new Error('최신 메모를 확인하지 못했어요. 다시 불러와 주세요.');
      onRestored((await current.json()).item);
      publishRecordChange('capture-unorganize');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : '입력함으로 되돌리지 못했어요. 다시 시도해 주세요.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="capture-organization" aria-label="메모 정리 상태">
      <p>정리 완료</p>
      {pageState === 'missing' && (
        <p>
          연결 페이지가 휴지통에 있거나 사라졌어요. <a href="/trash">휴지통에서 확인</a>하거나
          메모를 입력함으로 돌릴 수 있어요.
        </p>
      )}
      {pageState === 'error' && (
        <p>연결 페이지 상태를 확인하지 못했어요. 메모와 첨부는 보관돼 있어요.</p>
      )}
      <button disabled={busy || disabled} onClick={() => void restore()}>
        {busy ? '복원 확인 중…' : '입력함으로 되돌리기'}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
