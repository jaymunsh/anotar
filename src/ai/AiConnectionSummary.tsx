import { useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, Unplug, WifiOff } from 'lucide-react';
import { getAiStatus, type AiConnectionStatus } from './api';

export default function AiConnectionSummary({ research, hasUrl }: { research: boolean; hasUrl: boolean }) {
  const [connection, setConnection] = useState<AiConnectionStatus | null>(null);
  const [error, setError] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void getAiStatus(controller.signal).then(value => {
      if (!controller.signal.aborted) setConnection(value);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    const update = () => { setOnline(navigator.onLine); setReload(value => value + 1); };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    window.addEventListener('focus', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.removeEventListener('focus', update);
    };
  }, []);
  const unavailable = research && connection?.enabled && connection.researchModes &&
    !connection.researchModes.includes(hasUrl ? 'url' : 'keyword');
  const Icon = !online ? WifiOff : connection?.enabled ? CheckCircle2 : Unplug;
  return (
    <section className="ai-connection-summary" aria-label="AI 연결 상태" aria-live="polite">
      <div>
        <Icon size={15} aria-hidden="true" />
        <strong>{!online ? '오프라인 · 연결 후 실행' : error ? 'AI 연결 확인 필요' : !connection ? 'AI 연결 확인 중…' : connection.enabled ? connection.runner?.label || 'AI 연결됨' : 'AI 연결 필요'}</strong>
        <button type="button" onClick={() => setReload(value => value + 1)} aria-label="AI 연결 다시 확인" title="AI 연결 다시 확인"><RefreshCw size={14} /></button>
      </div>
      <p>{!online ? '메모와 요청문을 기기에 보관하고, 온라인으로 돌아오면 전송해요.' : error ? '연결을 확인하지 못했어요. 메모와 요청문은 보관할 수 있어요.' : connection && !connection.enabled ? '메모와 요청문은 보관할 수 있어요. 실행기를 연결한 뒤 다시 요청해 주세요.' : connection?.enabled ? '저장 후 처리하고, 결과는 원문과 별도로 보관해요.' : '서버의 실행 가능 여부를 확인하고 있어요.'}</p>
      {online && unavailable && <p className="ai-capability-warning">{hasUrl ? 'URL 리서치 연결이 필요해요.' : '키워드 리서치 연결이 필요해요.'} {hasUrl ? '다른 실행기를 연결하거나 직접 요청을 선택해 주세요.' : 'URL을 입력하거나 직접 요청을 선택해 주세요.'}</p>}
    </section>
  );
}
