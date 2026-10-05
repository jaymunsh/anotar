import { useContext, useEffect, useState } from 'react';
import type { Capture } from '../memos/types';
import type { AiJob } from '../ai/types';
import { PageNavContext } from './pageNav';
import { formatKoreanTime } from '../time';

export default function PageOrigins({ pageId }: { pageId: string }) {
  const [items, setItems] = useState<
    { capture: Capture | null; job: AiJob | null; operationId: string | null }[]
  >([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const navigate = useContext(PageNavContext);
  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    void fetch(`/api/pages/${pageId}/origins`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.items)) throw new Error();
        if (!controller.signal.aborted) {
          setItems(data.items);
          setState('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [pageId, retry]);
  return (
    <section className="page-origins" aria-label="페이지 출처">
      <h3>원본 메모</h3>
      {state === 'loading' ? (
        <p role="status">출처를 불러오는 중…</p>
      ) : state === 'error' ? (
        <p role="alert">
          출처를 불러오지 못했어요.{' '}
          <button onClick={() => setRetry((value) => value + 1)}>다시 불러오기</button>
        </p>
      ) : !items.length ? (
        <p>연결한 원본 메모가 없어요.</p>
      ) : (
        items.map((item, index) => (
          <div key={item.operationId || index}>
            {item.capture ? (
              <>
                <a
                  href={'/captures/' + item.capture.id}
                  onClick={(event) => {
                    if (!item.capture?.deletedAt) {
                      event.preventDefault();
                      navigate('/captures/' + item.capture!.id);
                    }
                  }}
                >
                  {item.capture.text ||
                    item.capture.url ||
                    item.capture.files[0]?.name ||
                    '원본 메모'}
                </a>
                <small>
                  {formatKoreanTime(item.capture.createdAt)}
                  {item.capture.deletedAt
                    ? ' · 휴지통'
                    : item.capture.organizedAt
                      ? ' · 정리 완료'
                      : ' · 입력함'}
                </small>
                {item.job && (
                  <details>
                    <summary>당시 AI 요청·결과</summary>
                    <pre>{item.job.request.prompt}</pre>
                    <pre>{item.job.result?.markdown || item.job.error || '결과 없음'}</pre>
                  </details>
                )}
              </>
            ) : (
              <p>원본 메모를 찾을 수 없어요.</p>
            )}
          </div>
        ))
      )}
    </section>
  );
}
