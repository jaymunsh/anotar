import { useState } from 'react';
import { ChevronDown, Code2, Settings2 } from 'lucide-react';
import { buildRequest, DIRECT_REQUEST, VARIABLE_LABELS } from './templates';
import type { PromptTemplate } from './templates';
import CopyRequestButton from './CopyRequestButton';
import AiExecutionPicker from '../ai/AiExecutionPicker';
import type { AiExecution } from '../../shared/aiRequests';
import './prompts.css';

type Props = {
  templates: PromptTemplate[];
  selectedId: string;
  onSelect: (id: string) => void;
  additional: string;
  onAdditional: (text: string) => void;
  input: { url: string; content: string };
  onManage: (id?: string) => void;
  libraryError: string;
  loading: boolean;
  onReload: () => void;
  execution?: AiExecution | null;
  onExecution: (value: AiExecution) => void;
  onAvailability?: (enabled: boolean) => void;
  subject?: 'memo' | 'page';
};

export default function AiRequestFields({
  templates,
  selectedId,
  onSelect,
  additional,
  onAdditional,
  input,
  onManage,
  libraryError,
  loading,
  onReload,
  execution, onExecution, onAvailability,
  subject = 'memo',
}: Props) {
  const [copyError, setCopyError] = useState('');
  const active = templates.filter((item) => !item.archived);
  const template = active.find((item) => item.id === selectedId);
  const unresolvedTemplate = selectedId !== DIRECT_REQUEST && !template;
  const request = buildRequest(template, input, additional);
  return (
    <div className="capture-ai-fields">
      <div className="capture-ai-input-summary">
        <strong>{subject === 'page' ? '저장한 페이지' : '지금 적은 메모'}</strong>
        <span>텍스트 {input.content.length.toLocaleString('ko-KR')}자{input.url ? ' · URL 포함' : ''} · 첨부 제외</span>
      </div>
      <div className="capture-ai-options">
        <label className="prompt-field">
          <span>템플릿</span>
          <select
            aria-label="AI 요청 템플릿"
            disabled={loading}
            value={selectedId}
            onChange={(event) => onSelect(event.target.value)}
          >
            <option value={DIRECT_REQUEST}>직접 요청</option>
            {unresolvedTemplate && <option value={selectedId}>선택한 템플릿 불러오기</option>}
            {(['research', 'free'] as const).map((kind) => (
              <optgroup key={kind} label={kind === 'research' ? '리서치' : '자유 요청'}>
                {active
                  .filter((item) => item.kind === kind)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
<details className="ai-additional-options" open={additional ? true : undefined}><summary>추가 지시</summary><label className="prompt-field">
          <input
            aria-label="AI 추가 요청"
            value={additional}
            maxLength={1000}
            onChange={(event) => onAdditional(event.target.value)}
            placeholder="예: 기술적인 부분을 조금 더 자세히"
          />
        </label></details>
      </div>
      {loading && (
        <p className="capture-ai-loading" role="status">
          템플릿을 불러오는 중…
        </p>
      )}
      <div className="capture-ai-description">
        <p>
          {unresolvedTemplate
            ? '선택한 템플릿을 불러온 뒤 요청문을 확인할 수 있어요.'
            : template?.description || '적은 내용을 그대로 요청문으로 사용해요.'}
        </p>
        <button className="prompt-text-button" type="button" onClick={() => onManage(template?.id)}>
          <Settings2 size={14} /> 템플릿 관리
        </button>
      </div>
      {template?.kind === 'research' && (
        <p className="capture-ai-loading">
          {input.url
            ? '입력한 URL의 본문을 읽고 출처와 함께 정리해요.'
            : '적은 주제·키워드로 관련 자료를 찾아 출처와 함께 정리해요. 웹 검색을 지원하는 실행기가 필요해요.'}
        </p>
      )}
      <details className="capture-ai-preview">
        <summary>
          <Code2 size={15} /> 요청 미리보기 <ChevronDown size={15} className="prompt-chevron" />
        </summary>
        <div className="prompt-preview-content">
          <div className="prompt-preview-heading">
            <span>AI에 전달할 요청문</span>
            <CopyRequestButton
              text={unresolvedTemplate ? '' : request.text}
              onError={setCopyError}
            />
          </div>
          {!!request.missing.length && (
            <p className="prompt-input-hint">
              {[...new Set(request.missing.map((key) => VARIABLE_LABELS[key]))].join(' · ')}을
              입력하면 해당 위치에 채워져요.
            </p>
          )}
          <pre className="prompt-result">
            {unresolvedTemplate
              ? '템플릿을 불러오면 요청문을 보여드려요.'
              : request.text ||
                (subject === 'page'
                  ? '저장한 페이지의 요청문을 여기에 보여요.'
                  : '메모를 입력하면 요청문이 여기에 보여요.')}
          </pre>
          {copyError && (
            <p className="prompt-error" role="alert">
              {copyError}
            </p>
          )}
        </div>
      </details>
      {libraryError && (
        <p className="prompt-error" role="alert">
          {libraryError}
          <button type="button" className="prompt-text-button" onClick={onReload}>
            다시 불러오기
          </button>
          <button
            type="button"
            className="prompt-text-button"
            onClick={() => onSelect(DIRECT_REQUEST)}
          >
            직접 요청으로 작성
          </button>
        </p>
      )}
      <AiExecutionPicker value={execution} onChange={onExecution} onAvailability={onAvailability} research={template?.kind === 'research'} hasUrl={Boolean(input.url)} />
    </div>
  );
}
