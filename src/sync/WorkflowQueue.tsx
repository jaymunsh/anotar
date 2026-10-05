import { useState } from 'react';
import { cancelQueuedWorkflow, dismissRejectedWorkflow, useQueuedWorkflows } from './workflows';
export default function WorkflowQueue({
  sourceId,
  onlyAi = false,
}: {
  sourceId?: string;
  onlyAi?: boolean;
}) {
  const queued = useQueuedWorkflows(sourceId),
    [error, setError] = useState('');
  const items = onlyAi ? queued.filter((p) => p.operation.kind === 'ai.submit') : queued;
  if (!items.length) return null;
  return (
    <section className="workflow-queue" aria-label="기기에서 전송 대기">
      <strong>기기에서 전송 대기 {items.length}건</strong>
      <p>연결 후 원본 저장을 확인하고 제출해요. 아직 서버에서 실행 중인 작업은 아니에요.</p>
      <ul>
        {items.slice(0, 50).map((item) => (
          <li key={item.operation.operationId}>
            <span>
              {item.operation.kind === 'capture.organize' ? '페이지에 정리' : 'AI 요청'} ·{' '}
              {String(
                ('sourceSnapshot' in item.operation.payload
                  ? (item.operation.payload.sourceSnapshot.title ??
                    item.operation.payload.sourceSnapshot.text)
                  : '') || '현재 내용',
              ).slice(0, 70)}
            </span>
            <small>
              {item.state === 'conflict'
                ? '변경 확인 필요'
                : item.state === 'sending'
                  ? '접수 확인 중'
                  : item.state === 'failed'
                    ? '요청 확인 필요'
                    : '전송 대기'}
            </small>
            {item.error && <p>{item.error}</p>}
            {item.state === 'queued' && item.attempt === 0 && (
              <button
                type="button"
                onClick={() =>
                  void cancelQueuedWorkflow(item.operation.operationId).catch((cause) =>
                    setError(cause.message),
                  )
                }
              >
                전송 전 취소
              </button>
            )}
            {['conflict', 'failed'].includes(item.state) &&
              item.errorCode &&
              item.errorCode !== 'payload_mismatch' && (
                <button
                  type="button"
                  onClick={() =>
                    void dismissRejectedWorkflow(item.operation.operationId).catch((cause) =>
                      setError(cause.message),
                    )
                  }
                >
                  요청 취소하고 원본 다시 확인
                </button>
              )}
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
