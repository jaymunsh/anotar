import { useEffect, useRef, useState } from 'react';
import { ScanText, Clipboard } from 'lucide-react';
type Job = {
  id: string;
  assetId: string;
  createdAt: string;
  status: 'queued' | 'running' | 'result_ready' | 'failed';
  text: string | null;
  error: string | null;
};
export default function AssetOcr({
  assetId,
  initialOpen = false,
}: {
  assetId: string;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(
      initialOpen || new URLSearchParams(window.location.search).get('ocrAsset') === assetId,
    ),
    [jobs, setJobs] = useState<Job[]>([]),
    [enabled, setEnabled] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0),
    [copied, setCopied] = useState(false);
  const linkedJob =
    new URLSearchParams(window.location.search).get('ocrAsset') === assetId
      ? new URLSearchParams(window.location.search).get('ocrJob')
      : null;
  const [selectedId, setSelectedId] = useState(linkedJob || '');
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    setSelectedId(linkedJob || '');
    if (linkedJob) setOpen(true);
    setCopied(false);
  }, [assetId, linkedJob]);
  useEffect(() => {
    if (!open) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function load() {
      if (document.hidden) return;
      try {
        const [list, config] = await Promise.all([
          fetch(`/api/assets/${assetId}/ocr`, { signal: controller.signal }),
          fetch('/api/ocr/status', { signal: controller.signal }),
        ]);
        if (!list.ok || !config.ok) throw Error();
        const data = await list.json(),
          setting = await config.json();
        if (linkedJob && !data.items.some((j: Job) => j.id === linkedJob)) {
          const response = await fetch(`/api/ocr-jobs/${linkedJob}`, { signal: controller.signal });
          if (!response.ok) throw Error();
          const { item } = await response.json();
          if (item.assetId !== assetId) throw Error();
          data.items.push(item);
        }
        if (stopped) return;
        setJobs(data.items);
        setEnabled(setting.enabled);
        setLoaded(true);
        setError('');
        if (data.items.some((j: Job) => j.status === 'queued' || j.status === 'running'))
          timer = setTimeout(() => void load(), 2000);
      } catch {
        if (!stopped) setError('이미지 인식 상태를 불러오지 못했어요.');
      }
    }
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void load();
      } else clearTimeout(timer);
    };
    document.addEventListener('visibilitychange', visible);
    void load();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [assetId, open, reload, linkedJob]);
  async function request() {
    if (busy) return;
    setBusy(true);
    setError('');
    const key = `leneu:ocr-request:${assetId}`;
    try {
      requestId.current ||= sessionStorage.getItem(key) || crypto.randomUUID();
      sessionStorage.setItem(key, requestId.current);
      const r = await fetch(`/api/assets/${assetId}/ocr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: requestId.current }),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      requestId.current = null;
      sessionStorage.removeItem(key);
      setJobs((j) => [result.item, ...j.filter((old) => old.id !== result.item.id)]);
      setSelectedId(result.item.id);
      setReload((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : '이미지를 요청하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }
  const newest = jobs[0],
    latest = selectedId ? jobs.find((j) => j.id === selectedId) : newest;
  return (
    <details className="asset-ocr" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <ScanText size={14} />
        이미지에서 글자 읽기
      </summary>
      <p>PNG·JPEG·WebP, 최대 5MB. 요청하면 연결된 이미지 인식 API로 전송해요. 원본은 유지합니다.</p>
      {!loaded && !error && <p role="status">상태 확인 중…</p>}
      {loaded && !enabled && <p>이미지 인식 실행기를 연결하면 사용할 수 있어요.</p>}
      <button
        disabled={!enabled || busy || newest?.status === 'queued' || newest?.status === 'running'}
        onClick={() => void request()}
      >
        {busy ? '요청 중…' : latest ? '다시 인식 요청' : '글자 인식 요청'}
      </button>
      {jobs.length > 1 && (
        <label>
          인식 이력{' '}
          <select
            aria-label="이미지 인식 이력"
            value={selectedId || newest?.id}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setCopied(false);
            }}
          >
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {new Date(j.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} ·{' '}
                {j.status === 'result_ready' ? '완료' : j.status === 'failed' ? '실패' : '처리 중'}
              </option>
            ))}
          </select>
        </label>
      )}
      {latest && (
        <p role="status">
          {
            {
              queued: '처리 대기 중',
              running: '글자를 읽는 중…',
              result_ready: '인식 완료',
              failed: '인식 실패',
            }[latest.status]
          }
        </p>
      )}
      {latest?.error && <p role="alert">{latest.error}</p>}
      {latest?.text && (
        <>
          <pre>{latest.text}</pre>
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(latest.text!)
                .then(() => setCopied(true))
                .catch(() => setError('텍스트를 선택해 직접 복사해 주세요.'))
            }
          >
            <Clipboard size={14} />
            {copied ? '복사됨' : '인식한 텍스트 복사'}
          </button>
        </>
      )}
      {error && (
        <p role="alert">
          {error} <button onClick={() => setReload((v) => v + 1)}>다시 불러오기</button>
        </p>
      )}
    </details>
  );
}
