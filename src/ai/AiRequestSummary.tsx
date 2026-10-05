import type { StoredAiRequest } from '../../shared/aiRequests';

export default function AiRequestSummary({ request }: { request: StoredAiRequest }) {
  return (
    <dl className="ai-request-summary" aria-label="사용한 요청 설정">
      <div>
        <dt>템플릿</dt>
        <dd>
          {request.template?.name || '직접 요청'}
          {request.template && <small>v{request.template.version}</small>}
        </dd>
      </div>
      <div>
        <dt>요청 유형</dt>
        <dd>{request.kind === 'research' ? '자료 조사' : '글 정리·작성'}</dd>
      </div>
      {request.additional.trim() && (
        <div className="ai-request-additional">
          <dt>추가 지시</dt>
          <dd>{request.additional}</dd>
        </div>
      )}
    </dl>
  );
}
