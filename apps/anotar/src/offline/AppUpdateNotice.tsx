import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { activatePreparedUpdate } from './update';
export default function AppUpdateNotice() {
  const [waiting, setWaiting] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let active = true;
    const check = () =>
      void navigator.serviceWorker.getRegistration('/').then((r) => {
        if (active) setWaiting(!!r?.waiting);
      });
    check();
    const timer = setInterval(check, 30000);
    document.addEventListener('visibilitychange', check);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  if (!waiting) return null;
  return (
    <div className="app-update-notice">
      <button
        disabled={busy}
        title="편집 중인 내용을 저장한 뒤 새 버전으로 다시 열어요."
        onClick={async () => {
          setBusy(true);
          try {
            await activatePreparedUpdate();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '업데이트를 준비하지 못했어요.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <RefreshCw size={14} aria-hidden className={busy ? 'is-spinning' : undefined} />
        <span>새 버전이 있어요</span>
        <strong>{busy ? '저장 중…' : '새로고침'}</strong>
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
